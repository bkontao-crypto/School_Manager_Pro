@echo off
chcp 65001 >nul
cd /d "%~dp0"
title School Manager Pro - Lancement
set PORT=3000
if not exist node_modules (echo Premiere utilisation : lancez d'abord 1-installer.bat & pause & exit /b 1)
if not exist .env (echo .env manquant : lancez d'abord 1-installer.bat & pause & exit /b 1)
echo Liberation du port %PORT% (anciens serveurs)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
echo Demarrage du serveur...
start "School Manager Pro - SERVEUR (ne pas fermer)" cmd /k "cd /d %~dp0 && set PORT=%PORT% && npm start"
timeout /t 4 >nul
start "" http://localhost:%PORT%
echo.
echo Site ouvert sur http://localhost:%PORT%
echo Pour arreter : fermez la fenetre du serveur ou lancez 4-arreter-site.bat
timeout /t 5 >nul
