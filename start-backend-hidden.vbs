' Start Fastify Backend in Hidden Mode (no CMD window)
' This script starts the backend service without showing a command window
' It runs until explicitly stopped

Set WshShell = CreateObject("WScript.Shell")

' Get the directory of this script
strScriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Change to the fastify-backend directory and start the server
' The 0 means run hidden, False means don't wait for completion
WshShell.Run "cmd /c cd /d """ & strScriptDir & "\fastify-backend"" && npm start", 0, False

' Also start Nginx if needed (optional)
' WshShell.Run """" & strScriptDir & "\nginx-1.28.1\nginx.exe""", 0, False

WScript.Echo "Fastify backend started in background!"
