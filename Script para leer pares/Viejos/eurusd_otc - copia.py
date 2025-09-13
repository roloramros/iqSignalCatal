import time
from iqoptionapi.stable_api import IQ_Option
from datetime import datetime, timedelta
from supabase import create_client, Client
from datetime import datetime, timedelta

def verificar_integridad_velas():
    # Leer las últimas 10 velas
    response = supabase.table("eurusd_otc") \
        .select("*") \
        .order("start_time", desc=True) \
        .limit(15) \
        .execute()

    datos = response.data
    if not datos or len(datos) < 15:
        print("❌ No hay suficientes velas para verificar integridad.")
        return

    # Ordenar en orden cronológico (de más antigua a más reciente)
    datos_ordenados = sorted(datos, key=lambda x: x['start_time'])

    # Convertir start_time a datetime
    tiempos = []
    for d in datos_ordenados:
        try:
            tiempos.append(datetime.strptime(d['start_time'], "%H:%M:%S"))
        except Exception as e:
            print(f"⚠️ Error al convertir hora: {d['start_time']} -> {e}")
            return

    # Verificar que entre cada vela haya 1 minuto de diferencia
    for i in range(1, len(tiempos)):
        diff = (tiempos[i] - tiempos[i-1]).total_seconds()
        if diff != 60:
            print(f"🚨 Falta una vela entre {datos_ordenados[i-1]['start_time']} y {datos_ordenados[i]['start_time']}")
            return      

def calculate_seconds_to_next_minute():
    """Calcula cuántos segundos faltan hasta el próximo minuto"""
    now = datetime.now()
    seconds_current_minute = now.second
    microseconds = now.microsecond / 1000000  # Convertir a fracción de segundo
    # Segundos que faltan hasta el próximo minuto
    seconds_to_next_minute = 60 - seconds_current_minute - microseconds
    # Añadir un pequeño buffer para asegurar que ya cambió el minuto
    seconds_to_next_minute += 0.1
    return max(0.1, seconds_to_next_minute)  # Mínimo 0.1 segundos
    
    
# DATOS DE CONEXIÓN
IQ_EMAIL = "iqoption.signalss@gmail.com"
IQ_PASSWORD = "Rolo880710*2024"
SUPABASE_URL = "https://lmhyfgagksvojfkbnygx.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaHlmZ2Fna3N2b2pma2JueWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0MjA4MzksImV4cCI6MjA2NTk5NjgzOX0.bD-j6tXajDumkB7cuck_9aNMGkrAdnAJLzQACoRYaJo"



# CONEXIÓN A IQ OPTION
I_want_money = IQ_Option(IQ_EMAIL, IQ_PASSWORD)
I_want_money.connect()

# CONEXIÓN A SUPABASE
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# BORRAR TODOS LOS DATOS EXISTENTES
print("🧹 Borrando registros anteriores...")
supabase.table("eurusd_otc").delete().neq("id", 0).execute()

# OBTENER TODAS LAS VELAS DE LOS ÚLTIMOS 180 MINUTOS
print("📥 Descargando las últimas 3 horas de velas...")
candles = I_want_money.get_candles("EURUSD-OTC", 60, 180, time.time())
if candles:
    candles.pop()
    candles.pop()

# ORDENAR DE MÁS ANTIGUA A MÁS RECIENTE
candles = sorted(candles, key=lambda x: x['from'])

# GUARDAR EN SUPABASE
print(f"💾 Guardando {len(candles)} velas en Supabase...")
for c in candles:
    start_price = float(c['open'])
    end_price = float(c['close'])
    start_time = datetime.fromtimestamp(c['from']).strftime('%H:%M:%S')
    end_time = datetime.fromtimestamp(c['to']).strftime('%H:%M:%S')

    data = {
        "start_time": start_time,
        "end_time": end_time,
        "start_price": start_price,
        "end_price": end_price
    }
    supabase.table("eurusd_otc").insert(data).execute()
if candles:
    last_candle_time = candles[-1]['from']

print("✅ Velas cargadas correctamente.")

# CONTINÚA MONITOREANDO LAS NUEVAS
#last_candle_time = 0
while True:
    candles = I_want_money.get_candles("EURUSD-OTC", 60, 2, time.time())
    if candles:
        current_candle = candles[1]
        previous_candle = candles[0]
        candle_time = current_candle['from']

        if candle_time != last_candle_time:
            start_price = float(previous_candle['open'])
            end_price = float(previous_candle['close'])
            start_time = datetime.fromtimestamp(previous_candle['from']).strftime('%H:%M:%S')
            end_time = datetime.fromtimestamp(previous_candle['to']).strftime('%H:%M:%S')

            data = {
                "start_time": start_time,
                "end_time": end_time,
                "start_price": start_price,
                "end_price": end_price
            }

            supabase.table("eurusd_otc").insert(data).execute()
            print(f"{start_time} - Vela cerrada guardada en Supabase.")
            last_candle_time = candle_time

            # ✅ Borrar registros del día anterior SOLO entre 3:00 y 23:59
            hora_actual = datetime.now().hour
            if 3 <= hora_actual <= 23:
                ayer = datetime.now() - timedelta(days=1)
                inicio_ayer = ayer.replace(hour=0, minute=0, second=0, microsecond=0)
                fin_ayer = ayer.replace(hour=23, minute=59, second=59, microsecond=999999)

                inicio_str = inicio_ayer.strftime("%Y-%m-%d %H:%M:%S")
                fin_str = fin_ayer.strftime("%Y-%m-%d %H:%M:%S")

                supabase.table("eurusd_otc") \
                    .delete() \
                    .gte("created_at", inicio_str) \
                    .lte("created_at", fin_str) \
                    .execute()

                print("🗑️ Registros del día anterior eliminados.")

            verificar_integridad_velas()

            sleep_time = calculate_seconds_to_next_minute() - 2
            time.sleep(sleep_time)

