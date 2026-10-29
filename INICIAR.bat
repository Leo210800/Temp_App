@echo off
title TempApp - Iniciar
cd /d "%~dp0"
if not exist "Backend\.venv\Scripts\python.exe" (
  echo Primero abre INSTALAR.bat ^(solo se hace una vez^).
  pause
  exit /b 1
)
echo Iniciando TempApp...
echo Se abriran dos ventanas negras: NO las cierres mientras usas la aplicacion.
start "TempApp - Servidor (no cerrar)" cmd /k "cd /d "%~dp0Backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
start "TempApp - Interfaz (no cerrar)" cmd /k "cd /d "%~dp0Frontend" && npm run dev"
echo Esperando a que arranque...
timeout /t 10 /nobreak >nul
start "" http://localhost:5173
echo.
echo Si la pagina sale en blanco, espera unos segundos y presiona F5.
echo Para cerrar la aplicacion, cierra las dos ventanas negras.
timeout /t 8 >nul
