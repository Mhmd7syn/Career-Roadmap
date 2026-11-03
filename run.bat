@echo off
title Career Knowledge Graph Runner
cd /d "%~dp0"

echo ===================================================================
echo  Career Knowledge Graph Runner (Python 3.14)
echo  Local Canvas & Graph-as-Directory Platform
echo ===================================================================

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python was not found in your PATH.
    echo Please install Python 3.14 or add it to your PATH environment variable.
    pause
    exit /b 1
)

python server.py
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Server terminated with an error code.
    pause
)
