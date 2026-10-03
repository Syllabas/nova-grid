# Nova Grid · version en ligne

Course antigravité multijoueur : salons à code de 4 lettres, jusqu'à 16 joueurs,
les IA complètent le peloton (12, 40, 80 ou 120 bolides). Le navigateur de l'hôte
fait rouler les IA, le serveur relaie les positions en temps réel.

## Option 1 : en ligne en permanence (Render, gratuit)

1. Crée un compte sur https://github.com puis un nouveau dépôt (ex. `nova-grid`).
2. Dans le dépôt : **Add file → Upload files**, glisse tout le contenu de ce dossier
   (`server.js`, `package.json`, `render.yaml`, `README.md` et le dossier `public`), puis **Commit changes**.
3. Va sur https://render.com et connecte-toi avec GitHub.
4. **New → Blueprint**, choisis ton dépôt : Render lit `render.yaml` et crée le service gratuit.
   (Sinon : **New → Web Service**, Build Command `npm install`, Start Command `node server.js`, plan Free.)
5. Au bout de 2-3 minutes tu as une adresse du type `https://nova-grid-xxxx.onrender.com`.
   Envoie-la à tes potes.

Bon à savoir : sur l'offre gratuite, le serveur s'endort après 15 minutes sans
visite et met environ une minute à se réveiller. Pendant une course, il reste éveillé.

### Garder le classement du contre-la-montre (recommandé sur Render)

Sur l'offre gratuite de Render, les fichiers du serveur sont effacés à chaque
redémarrage : le classement repartirait de zéro. Pour le garder :

1. Crée une base Redis gratuite sur https://upstash.com (pas de carte bancaire).
2. Dans la page de la base, onglet **REST API**, copie `UPSTASH_REDIS_REST_URL`
   et `UPSTASH_REDIS_REST_TOKEN`.
3. Sur Render, dans ton service : **Environment → Add Environment Variable**,
   ajoute ces deux variables avec leurs valeurs, puis **Save**.

Le serveur sauvegarde alors le classement et les fantômes dans Upstash.
Sans ces variables, il garde tout dans `data/tt.json` (parfait sur ton PC).

## Option 2 : sur ton PC, le temps d'une soirée

1. Installe Node.js 18 ou plus récent (https://nodejs.org).
2. Dans ce dossier : `npm install` puis `npm start`.
3. Ouvre http://localhost:3000 pour vérifier.
4. Pour tes potes, installe cloudflared puis lance
   `cloudflared tunnel --url http://localhost:3000` : il affiche une adresse
   `https://….trycloudflare.com` à partager. Elle marche tant que ton PC et la commande tournent.

## Jouer

Ouvre l'adresse → menu **Format : En ligne** → **Ouvrir le salon** →
pseudo → **Créer un salon** (ou tape le code d'un pote). L'hôte règle le
circuit, le niveau des IA et la taille du peloton, puis lance. Les points du salon
s'additionnent course après course (barème du jeu + 2 points au meilleur tour).

Le bouton « En ligne » n'apparaît que quand la page est servie par ce serveur.
