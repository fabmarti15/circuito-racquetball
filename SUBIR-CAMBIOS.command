#!/bin/bash
# Doble clic para subir a GitHub los cambios ya commiteados.
# No pide token: usa el que ya está guardado en el Keychain de macOS
# (el mismo de tus otros repos). Solo lo pide si el Keychain no lo tiene.
# No borra historial ni fuerza nada, al contrario de PUBLICAR-EN-GITHUB.command,
# que era solo para la primera publicación (ese hace rm -rf .git + push --force).
cd "$(dirname "$0")" || exit 1
clear
echo "==================================================="
echo "  Subir cambios del visor del Circuito a GitHub"
echo "==================================================="
echo

if [ ! -d .git ]; then echo "Aquí no hay repositorio git. Cancelado."; read -p "Enter para cerrar."; exit 1; fi

# El helper del Keychain: así no hay que pegar token nunca más.
git config credential.helper osxkeychain

REMOTE=$(git remote get-url origin 2>/dev/null)
USER_REPO=$(echo "$REMOTE" | sed -n 's|.*github.com[:/]\([^/]*\)/\([^/.]*\).*|\1/\2|p')
echo "Repositorio: ${USER_REPO:-$REMOTE}"

PEND=$(git log --oneline origin/main..HEAD 2>/dev/null)
if [ -z "$PEND" ]; then
  echo
  echo "Según lo que tengo acá no hay nada pendiente. Reviso igual contra GitHub..."
else
  echo
  echo "Commits por subir:"
  echo "$PEND" | sed 's/^/   /'
fi

echo
echo "-> Revisando si GitHub tiene commits que no están acá..."
if git fetch origin main 2>/tmp/rqfetch.err; then
  PENDIENTES_REMOTOS=$(git log --oneline HEAD..FETCH_HEAD 2>/dev/null)
  if [ -n "$PENDIENTES_REMOTOS" ]; then
    echo "   GitHub tiene commits nuevos:"
    echo "$PENDIENTES_REMOTOS" | sed 's/^/      /'
    # El bot que actualiza los datos cada 10 minutos solo toca data/. Eso se
    # integra solo, dando prioridad a lo que hay acá, que es lo recién generado.
    # Si el remoto tocó código, ahí sí hay que mirarlo a mano.
    TOCADO=$(git diff --name-only HEAD...FETCH_HEAD | grep -v '^data' | grep -v '^data.json$' || true)
    if [ -n "$TOCADO" ]; then
      echo
      echo "   !! Esos commits cambian código, no solo datos:"
      echo "$TOCADO" | sed 's/^/      /'
      echo "   No subo nada para no pisarlos. Avísame y los integramos juntos."
      read -p "Enter para cerrar."; exit 1
    fi
    echo "   Son solo actualizaciones de datos del bot: se integran automáticamente."
    if ! git merge -X ours FETCH_HEAD -m "Integrar datos del bot" >/dev/null 2>&1; then
      echo "   !! No se pudo integrar automáticamente. Avísame."
      git merge --abort 2>/dev/null
      read -p "Enter para cerrar."; exit 1
    fi
    echo "   Integrado."
  else
    echo "   Sin novedades en GitHub."
  fi
else
  echo "   (no pude consultar GitHub; sigo e intento subir)"
  sed 's/^/      /' /tmp/rqfetch.err 2>/dev/null | head -3
fi
rm -f /tmp/rqfetch.err

if [ -z "$(git log --oneline origin/main..HEAD 2>/dev/null)" ]; then
  echo
  echo "Todo lo local ya está en GitHub. Nada que hacer."
  read -p "Enter para cerrar."; exit 0
fi

echo
echo "-> Subiendo..."
if git push origin HEAD:main 2>/tmp/rqpush.err; then
  USER=${USER_REPO%%/*}; REPO=${USER_REPO##*/}
  echo
  echo "==================================================="
  echo "  LISTO. Ya está en GitHub."
  echo "  Web:  https://$USER.github.io/$REPO/ahora.html"
  echo
  echo "  Si da 404, Pages no está activado en este repo:"
  echo "  github.com/$USER_REPO  ->  Settings  ->  Pages  ->"
  echo "  Source: Deploy from a branch  ->  main / (root)  ->  Save."
  echo "==================================================="
else
  echo "   !! No se pudo subir:"
  sed 's/^/      /' /tmp/rqpush.err
  echo
  echo "   Si dice 'could not read Username', el Keychain no tiene el token."
  echo "   Crea uno en https://github.com/settings/tokens/new (marca [x] repo),"
  echo "   vuelve a correr este archivo y pégalo cuando lo pida: queda guardado"
  echo "   en el Keychain y no lo vuelve a pedir."
fi
rm -f /tmp/rqpush.err
echo
read -p "Enter para cerrar."
