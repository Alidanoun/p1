@echo off
set FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch al_markazia_backend/uploads" --prune-empty --tag-name-filter cat -- --all
