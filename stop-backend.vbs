' Stop Fastify Backend
' This script finds and terminates the node.exe process running the backend

Set WshShell = CreateObject("WScript.Shell")

' Kill node processes (this will stop the Fastify server)
' Use /F to force, /IM to match by image name
WshShell.Run "taskkill /F /IM node.exe", 0, True

WScript.Echo "Backend services stopped!"
