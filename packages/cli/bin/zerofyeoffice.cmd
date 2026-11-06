@echo off
rem zerofyeoffice launcher for the packaged Windows app: <install>\resources\cli\zerofyeoffice.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\ZerofyeOffice.exe" "%~dp0zerofyeoffice.cjs" %*
endlocal
