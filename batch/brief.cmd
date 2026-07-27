@echo off
rem invest-koro after-close AI brief batch (manual run only; scheduler registration NOT approved yet)
"C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/kojit/Documents/ClaudeCode && CLAUDE_BIN='C:/Users/kojit/.local/bin/claude.exe' bash repos/invest-cockpit/batch/brief.sh >> memory/cron.log 2>&1"
