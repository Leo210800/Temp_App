@echo off
title TempApp - Instalacion
cd /d "%~dp0"
echo ============================================================
echo   TempApp - Instalacion (solo se hace UNA vez)
echo ============================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Python.
  echo Instalalo desde python.org y marca la casilla "Add Python to PATH".
  echo Luego vuelve a abrir este archivo.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js.
  echo Instala la version 22 LTS desde nodejs.org, reinicia la computadora
  echo y vuelve a abrir este archivo.
  pause
  exit /b 1
)

echo [1/3] Preparando el servidor (Backend). Puede tardar unos minutos...
cd /d "%~dp0Backend"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion del Backend. Toma una foto de esta pantalla y enviasela a Leo.
  pause
  exit /b 1
)

echo.
echo [2/3] Preparando la interfaz (Frontend). Puede tardar unos minutos...
cd /d "%~dp0Frontend"
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion del Frontend. Toma una foto de esta pantalla y enviasela a Leo.
  pause
  exit /b 1
)

echo.
echo [3/3] Conexion a la base de datos
cd /d "%~dp0Backend"
if not exist ".env" copy ".env.example" ".env" >nul
echo Se abrira el Bloc de notas con el archivo de configuracion.
echo  1. Borra la linea que empieza con DATABASE_URL=
echo  2. Pega en su lugar la linea que te envio Leo
echo  3. Guarda (Ctrl + G o Ctrl + S) y cierra el Bloc de notas
echo.
pause
notepad ".env"

echo.
echo ============================================================
echo   Listo. Ahora abre INICIAR.bat para usar la aplicacion.
echo ===========================================================
pause
