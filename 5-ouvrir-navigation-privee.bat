@echo off
chcp 65001 >nul
rem Ouvre le site sans cache ni service worker (utile si les boutons ne repondent pas).
set URL=http://localhost:3000
where chrome >nul 2>&1 && (start "" chrome --incognito %URL% & exit /b)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --incognito %URL% & exit /b)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" -inprivate %URL% & exit /b)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" -inprivate %URL% & exit /b)
start "" %URL%
