@echo off
cd /d "C:\Users\liozm\Desktop\moshe\annual-reports"
git worktree prune 2>nul
if not exist ".claude\worktrees" mkdir ".claude\worktrees"
claude --worktree
