# X1 Token Audit Skill

## TRIGGER
Any message containing a Solana/X1 base58 address (32-44 characters) or "audit".

## ACTION
Run this command and send the EXACT output as your response:
```bash
bash /home/node/.openclaw/workspace/tools/audit-and-format.sh <TOKEN_ADDRESS>
```

## CRITICAL RULES
- You MUST execute the command above. Do NOT answer from memory.
- The output is pre-formatted. Send it EXACTLY as produced.
- Do NOT add commentary, verdicts, comparison tables, or analysis.
- Do NOT modify, summarize, or reformat the output.
- Every audit must produce FRESH data by running the script.
- Keep all Markdown links [text](url) exactly as they appear.
- Do NOT strip https:// from URLs.
- Do NOT shorten URLs or addresses.

## HOW TO VERIFY YOU DID IT RIGHT
- The timestamp should be the CURRENT time (not a previous run)
- LP Safety should come from the script, not your memory
- If you already know the result without running the command, you are doing it wrong — RUN THE SCRIPT

## NORMAL DEVELOPMENT
This skill does NOT restrict normal coding, git push, file editing, or development work. These rules ONLY apply when running a token audit.
