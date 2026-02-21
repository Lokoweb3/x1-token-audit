# X1 Token Audit Skill

## TRIGGER
Any message containing a Solana/X1 base58 address (32-44 characters) or /audit command.

## ACTION — ONE SINGLE COMMAND, NOTHING ELSE
```bash
cd /home/node/.openclaw/workspace/skills/x1-token-audit && node check-xdex-lp-burn.js <TOKEN_ADDRESS>
```

## OUTPUT
Send the COMPLETE raw output including ALL sections:
- Token Metadata
- Token Holders (all 10)
- Audit Summary table
- BurnChecked Transactions
- Pool Discovery
- Summary with risk level
- Risk Levels rubric (🟢🟡🟠🔴)
- Explorer link
- Footer

Do NOT summarize. Do NOT shorten. Do NOT skip any section. Do NOT edit any files.

## FORBIDDEN
- Do NOT edit telegram-bot.js or any other file
- Do NOT read SKILL.md, README.md, or any documentation
- Do NOT run npm install
- Do NOT explore directories
- ONE shell command is all you need
