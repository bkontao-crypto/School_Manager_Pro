@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Sauvegarde de la base...
call npm run backup
pause
