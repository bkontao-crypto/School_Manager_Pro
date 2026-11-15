@echo off
chcp 65001 >nul
cd /d "%~dp0"
title School Manager Pro - Installation
echo ==================================================
echo   SCHOOL MANAGER PRO - Installation (a faire 1 fois)
echo ==================================================
where node >nul 2>&1 || (echo [ERREUR] Node.js n'est pas installe. Telechargez-le sur https://nodejs.org & pause & exit /b 1)
echo.
echo [1/3] Installation des dependances...
call npm install || (echo [ERREUR] npm install a echoue. & pause & exit /b 1)
echo.
echo [2/3] Fichier .env...
if not exist .env (
  copy .env.example .env >nul
  echo .env cree a partir de .env.example
) else (
  echo .env existe deja, conserve.
)
node -e "const fs=require('fs');let t=fs.readFileSync('.env','utf8');if(/^JWT_SECRET=[ \t]*\r?$/m.test(t)){t=t.replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'));fs.writeFileSync('.env',t);console.log('JWT_SECRET genere.');}"
echo.
echo [3/3] Generation du CSS...
call npm run build:css
echo.
echo ==================================================
echo  IMPORTANT : le fichier .env va s'ouvrir.
echo  Renseignez DATABASE_URL avec votre base PostgreSQL :
echo  postgresql://utilisateur:motdepasse@localhost:5432/school_manager_pro
echo  (la base school_manager_pro doit deja exister dans PostgreSQL)
echo  Enregistrez, fermez le Bloc-notes, puis lancez 2-base-de-donnees.bat
echo ==================================================
notepad .env
pause
