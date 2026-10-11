"""Provision Vercel environment variables via stdin without printing secret values."""
from dotenv import dotenv_values
import subprocess
import sys
values=dotenv_values('.env.local')
for key,value in values.items():
    if not value or key not in ('NEXT_PUBLIC_PRIVY_APP_ID','PRIVY_APP_SECRET','DATABASE_URL','GENLAYER_PRIVATE_KEY','GENLAYER_RPC_URL','WORKER_SECRET','ENCRYPTION_KEY','GENLAYER_REGISTRY_ADDRESS','GENLAYER_VAULT_ADDRESS'):continue
    args=['vercel','env','add',key,'production','--force','--yes']
    if key in ('PRIVY_APP_SECRET','DATABASE_URL','GENLAYER_PRIVATE_KEY','WORKER_SECRET','ENCRYPTION_KEY'):args.append('--sensitive')
    result=subprocess.run(args,input=value,capture_output=True,text=True)
    if result.returncode:
        print('Environment provisioning failed for',key,flush=True)
        # Values and raw CLI output intentionally stay private.
        sys.exit(result.returncode)
    print('Configured',key,flush=True)
