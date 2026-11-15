@echo off
chcp 65001 >nul
cd /d "%~dp0"
title School Manager Pro - Base de donnees
echo ==================================================
echo   Creation des tables + compte de demonstration
echo ==================================================
if not exist .env (echo [ERREUR] .env manquant. Lancez d'abord 1-installer.bat & pause & exit /b 1)
echo.
echo [1/2] Migrations (001 a 025)...
call npm run migrate || (echo [ERREUR] Migration impossible : verifiez DATABASE_URL dans .env et que PostgreSQL tourne. & pause & exit /b 1)
echo.
echo [2/2] Donnees de demonstration...
echo NOTEZ le mot de passe affiche ci-dessous : il ne s'affiche qu'une seule fois.
echo Connexion : code etablissement DEMO, e-mail admin@demo.local
echo.
call npm run seed
echo.
pause
