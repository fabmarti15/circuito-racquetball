#!/bin/bash
# Doble clic para subir a GitHub los cambios ya commiteados, SIN borrar el historial.
# Distinto de PUBLICAR-EN-GITHUB.command, que era solo para la primera publicación
# (ese hace `rm -rf .git` y `push --force`: no usarlo más, borra el historial).
cd "$(dirname "$0")" || exit 1
clear
echo "==================================================="
echo "  Subir cambios del visor del Circuito a GitHub"
echo "==================================================="
echo

if [ ! -d .git ]; then echo "Aquí no hay repositorio git. Cancelado."; read -p "Enter para cerrar."; exit 1; fi

PEND=$(git log --oneline @{u}..HEAD 2>/dev/null || git log --oneline -1)
if [ -z "$PEND" ]; then
  echo "No hay nada pendiente por subir."
  read -p "Enter para cerrar."; exit 0
fi
echo "Commits por subir:"
echo "$PEND" | sed 's/^/   /'
echo

REMOTE=$(git remote get-url origin 2>/dev/null)
USER_REPO=$(echo "$REMOTE" | sed -n 's|.*github.com[:/]\([^/]*\)/\([^/.]*\).*|\1/\2|p')
if [ -z "$USER_REPO" ]; then echo "No pude leer el repositorio remoto ($REMOTE). Cancelado."; read -p "Enter para cerrar."; exit 1; fi
echo "Repositorio: $USER_REPO"
echo

echo "Necesito un token de GitHub con permiso 'repo':"
echo "   https://github.com/settings/tokens/new   ->  [x] repo  ->  Generate token"
printf "Pega el token y presiona Enter (no se muestra ni se guarda): "
read -s TOKEN
echo
if [ -z "$TOKEN" ]; then echo "Sin token. Cancelado."; read -p "Enter para cerrar."; exit 1; fi

echo
echo "-> Revisando si GitHub tiene commits que tú no tienes..."
git -c credential.helper= fetch "https://x-access-token:$TOKEN@github.com/$USER_REPO.git" main 2>/dev/null
if [ -n "$(git log --oneline HEAD..FETCH_HEAD 2>/dev/null)" ]; then
  echo
  echo "   !! GitHub tiene cambios que no están acá:"
  git log --oneline HEAD..FETCH_HEAD | sed 's/^/      /'
  echo "   No subo nada para no pisarlos. Avísame y los integramos primero."
  read -p "Enter para cerrar."; exit 1
fi

echo "-> Subiendo..."
if git push "https://x-access-token:$TOKEN@github.com/$USER_REPO.git" HEAD:main 2>/tmp/rqpush.err; then
  git fetch origin main >/dev/null 2>&1
  echo
  echo "==================================================="
  echo "  LISTO. Ya está en GitHub."
  USER=${USER_REPO%%/*}; REPO=${USER_REPO##*/}
  echo "  Web:  https://$USER.github.io/$REPO/ahora.html"
  echo
  echo "  Si da 404: repo -> Settings -> Pages -> Source:"
  echo "  Deploy from a branch -> main / (root) -> Save."
  echo "==================================================="
else
  echo "   !! No se pudo subir:"
  sed 's/^/      /' /tmp/rqpush.err
fi
rm -f /tmp/rqpush.err
echo
read -p "Enter para cerrar."
