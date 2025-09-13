import time
import requests
from iqoptionapi.stable_api import IQ_Option
from datetime import datetime, timedelta
from supabase import create_client, Client
import httpx

# --- DATOS DE CONEXIÓN ---
IQ_EMAIL = "iqoption.signalss@gmail.com"
IQ_PASSWORD = "Rolo880710*2024"
SUPABASE_URL = "https://lmhyfgagksvojfkbnygx.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaHlmZ2Fna3N2b2pma2JueWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0MjA4MzksImV4cCI6MjA2NTk5NjgzOX0.bD-j6tXajDumkB7cuck_9aNMGkrAdnAJLzQACoRYaJo"

# --- TELEGRAM ---
TELEGRAM_TOKEN = "8403266609:AAEBEnN1i72-7kYbd2dsZtEjSuhsrxkjQ7c"
TELEGRAM_CHAT_ID = "1589398506"  # ⚠️ cambia esto por tu chat_id real

def enviar_telegram_error(mensaje: str):
    par = "Par: GBP/USD"
    resultado = f"{par}\n{mensaje}"
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        data = {"chat_id": TELEGRAM_CHAT_ID, "text": resultado}
        requests.post(url, data=data, timeout=10)
    except Exception as e:
        print(f"❌ No se pudo enviar error a Telegram: {e}")

# --- FUNCIONES AUXILIARES ---
def conectar_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

supabase: Client = conectar_supabase()

def ejecutar_query(query_func, intentos=5, espera=5):
    global supabase
    for i in range(intentos):
        try:
            return query_func()
        except Exception as e:
            mensaje_error = f"⚠️ Error en Supabase: {e}"
            if i == 0:
                enviar_telegram_error(mensaje_error)
            enviar_telegram_error(f"🔄 Reintentando conexión... intento {i+1}/{intentos}")
            print(f"{mensaje_error} (intento {i+1}/{intentos})")
            time.sleep(espera)
            supabase = conectar_supabase()
    enviar_telegram_error("❌ No se pudo reconectar con Supabase después de varios intentos.")
    raise Exception("No se pudo ejecutar query después de varios intentos")

# --- CALCULAR TIEMPO HASTA EL PRÓXIMO MINUTO ---
def calculate_seconds_to_next_minute():
    now = datetime.now()
    seconds_current_minute = now.second
    microseconds = now.microsecond / 1_000_000
    seconds_to_next_minute = 60 - seconds_current_minute - microseconds
    seconds_to_next_minute += 0.1
    return max(0.1, seconds_to_next_minute)

# --- VERIFICAR INTEGRIDAD DE VELAS ---
def verificar_integridad_velas():
    response = ejecutar_query(lambda: supabase.table("gbpusd_otc")
                              .select("*")
                              .order("start_time", desc=True)
                              .limit(15)
                              .execute())

    datos = response.data
    if not datos or len(datos) < 15:
        print("❌ No hay suficientes velas para verificar integridad.")
        return

    datos_ordenados = sorted(datos, key=lambda x: x['start_time'])
    tiempos = []
    for d in datos_ordenados:
        try:
            tiempos.append(datetime.strptime(d['start_time'], "%H:%M:%S"))
        except Exception as e:
            mensaje = f"⚠️ Error al convertir hora: {d['start_time']} -> {e}"
            print(mensaje)
            enviar_telegram_error(mensaje)
            return

    for i in range(1, len(tiempos)):
        diff = (tiempos[i] - tiempos[i-1]).total_seconds()
        if diff != 60:
            mensaje = (f"🚨 Falta una vela entre {datos_ordenados[i-1]['start_time']} "
                       f"y {datos_ordenados[i]['start_time']}")
            print(mensaje)
            enviar_telegram_error(mensaje)
            return

# --- IQ OPTION ---
I_want_money = IQ_Option(IQ_EMAIL, IQ_PASSWORD)
I_want_money.connect()

# --- BORRAR DATOS EXISTENTES ---
print("🧹 Borrando registros anteriores...")
ejecutar_query(lambda: supabase.table("gbpusd_otc").delete().neq("id", 0).execute())

# --- DESCARGAR VELAS HISTÓRICAS ---
print("📥 Descargando las últimas 3 horas de velas...")
candles = I_want_money.get_candles("GBPUSD-OTC", 60, 180, time.time())
if candles:
    candles.pop()
    candles.pop()

candles = sorted(candles, key=lambda x: x['from'])

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
    ejecutar_query(lambda: supabase.table("gbpusd_otc").insert(data).execute())

if candles:
    last_candle_time = candles[-1]['from']

print("✅ Velas cargadas correctamente.")

# --- LOOP PRINCIPAL ---
ultima_eliminacion = None

while True:
    candles = I_want_money.get_candles("GBPUSD-OTC", 60, 2, time.time())
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

            ejecutar_query(lambda: supabase.table("gbpusd_otc").insert(data).execute())
            last_candle_time = candle_time

            # ✅ Borrar registros del día anterior solo una vez a las 3:00 AM
            ahora = datetime.now()
            if ahora.hour == 3 and (ultima_eliminacion is None or ultima_eliminacion.date() < ahora.date()):
                ayer = ahora - timedelta(days=1)
                inicio_ayer = ayer.replace(hour=0, minute=0, second=0, microsecond=0)
                fin_ayer = ayer.replace(hour=23, minute=59, second=59, microsecond=999999)

                inicio_str = inicio_ayer.strftime("%Y-%m-%d %H:%M:%S")
                fin_str = fin_ayer.strftime("%Y-%m-%d %H:%M:%S")

                ejecutar_query(lambda: supabase.table("gbpusd_otc")
                               .delete()
                               .gte("created_at", inicio_str)
                               .lte("created_at", fin_str)
                               .execute())

                ultima_eliminacion = ahora
                print("🗑️ Registros del día anterior eliminados.")
                enviar_telegram_error("🗑️ Registros del día anterior eliminados correctamente a las 3:00 AM.")

            # Verificar integridad de velas
            verificar_integridad_velas()

            # Dormir hasta el inicio exacto del siguiente minuto
            sleep_time = calculate_seconds_to_next_minute() - 2
            time.sleep(sleep_time)
