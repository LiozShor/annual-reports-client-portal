# gitleaks allowlist-bypass regression fixture
# See test-gitleaks-allowlist.sh — concatenated at test-time.
# Both halves are split so neither half matches any rule on its own.
ALLOWLISTED_LINE=`[REDACTED-AIRTABLE-PAT-1]`
LEAK_PREFIX=pat2FAKEFAKEFAKEX
LEAK_SUFFIX=.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
