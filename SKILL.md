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
- If the output contains HTML tags like <a href> or <code>, keep them exactly as-is.

## HOW TO VERIFY YOU DID IT RIGHT
- The timestamp should be the CURRENT time (not a previous run)
- You should see "LP Safety: 48.9%" for AGI token (not 99.9% or 100%)
- If you see 99.9% or 100% you are answering from memory — RUN THE SCRIPT
- Market cap should show realistic values (e.g., $10K for AGI, not $249)
- Liquidity should show actual TVL values (e.g., $1.65K for AGI, not $0.04)

## NORMAL DEVELOPMENT
This skill does NOT restrict normal coding, git push, file editing, or development work.
