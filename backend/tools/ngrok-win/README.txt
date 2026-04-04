REQUIRED: ngrok agent v3.20+ (WinGet often gives 3.3.1 = ERR_NGROK_121).

1) Download Windows zip: https://ngrok.com/download
2) Extract ngrok.exe into THIS folder (same folder as this README).
3) From the backend folder run:
     powershell -ExecutionPolicy Bypass -File .\scripts\start-ngrok.ps1
4) One-time auth (use the exe you just extracted):
     .\tools\ngrok-win\ngrok.exe config add-authtoken YOUR_TOKEN
