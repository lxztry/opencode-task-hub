@echo off
cd /d "%~dp0"

echo 安装 OpenCode Task Hub...

set PLUGIN_DIR=%USERPROFILE%\.config\opencode\plugins
if not exist "%PLUGIN_DIR%" mkdir "%PLUGIN_DIR%"

copy /y plugins\task-reporter.js "%PLUGIN_DIR%\"

set CONFIG_FILE=%USERPROFILE%\.config\opencode\opencode.json
if exist "%CONFIG_FILE%" (
  findstr /C:"task-reporter" "%CONFIG_FILE%" >nul
  if errorlevel 1 (
    echo 请在 opencode.json 中添加插件配置
    type nul > "%CONFIG_FILE%.new"
    echo { >> "%CONFIG_FILE%.new"
    echo   "plugin": ["task-reporter"] >> "%CONFIG_FILE%.new"
  )
) else (
  echo { "plugin": ["task-reporter"] } > "%CONFIG_FILE%"
)

echo.
echo 安装完成!
echo.
echo 1. 运行 npm install
echo 2. 运行 npm start 启动任务服务器
echo 3. 打开 http://localhost:3030 查看仪表板
echo.
pause
