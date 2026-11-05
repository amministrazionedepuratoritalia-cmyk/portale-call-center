#!/bin/bash
# Carica la chiave JSON dell'account di servizio Google (scaricata in ~/Downloads) nella tabella protetta
# cc_sync_state del progetto Supabase, usando la CLI Supabase già autenticata su questo Mac.
set -e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
f=$(ls -t "$HOME"/Downloads/portale-call-center-*.json 2>/dev/null | head -1)
if [ -z "$f" ]; then echo "Non trovo il file portale-call-center-*.json in Downloads"; exit 1; fi
tmp=$(mktemp)
python3 -I - "$f" "$tmp" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
assert d.get('client_email') and d.get('private_key'), 'file chiave incompleto'
j=json.dumps(d,ensure_ascii=False)
open(sys.argv[2],'w').write("insert into cc_sync_state(k,v) values ('GCAL_SERVICE_ACCOUNT', $k$"+j+"$k$) on conflict (k) do update set v=excluded.v;\n")
PY
npx -y supabase@latest db query --remote=nhpmsgllgxjqzyynjbwf --yes --output-format json --file "$tmp" >/dev/null
rm -f "$tmp"
echo "Chiave caricata. Ora puoi cancellare il file $f"
