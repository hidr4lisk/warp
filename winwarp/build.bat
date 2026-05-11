@echo off
echo ═══════════════════════════════════════
echo  Hidr4lisk_WARP — Windows Build
echo ═══════════════════════════════════════
echo.
echo Installing dependencies...
pip install paho-mqtt cryptography tkinterdnd2 pyinstaller
echo.
echo Building exe...
pyinstaller --collect-all tkinterdnd2 --windowed --onefile --name Hidr4lisk_WARP_windows winwarp.py
echo.
echo Done! Exe is in dist\
echo.
pause
