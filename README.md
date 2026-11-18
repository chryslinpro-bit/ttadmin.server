# Tiako dia Tiako — API

API NestJS et PostgreSQL pour les produits, stocks, commandes, utilisateurs et
l’intégration Facebook/Meta.

## Installation et démarrage

Prérequis : Node.js et PostgreSQL.

```bash
npm install
cp .env.example .env
```

Renseignez au minimum `DATABASE_URL`, `JWT_SECRET` et `CSRF_SECRET` dans `.env`.
Créez deux secrets distincts d’au moins 32 caractères, par exemple avec
`openssl rand -hex 32`.

La migration initiale est destinée à une base vide ; les migrations suivantes
ajoutent les fonctionnalités du catalogue et de sécurité. Vérifiez la base
ciblée avant de les lancer : n’effacez pas l’historique de migrations et ne
faites pas de reset sur une base contenant des données.

```bash
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

L’API écoute par défaut sur <http://localhost:5000>. Pour créer l’administrateur
initial en développement, définissez `SEED_ADMIN_EMAIL` et
`SEED_ADMIN_PASSWORD` dans `.env`, puis lancez :

```bash
npm run db:seed:admin
```

## Sécurité du compte

Les nouveaux comptes reçoivent par e-mail un mot de passe provisoire aléatoire
de 8 caractères. Dans la rubrique **Sécurité** du frontend, un utilisateur peut
demander un changement de mot de passe en saisissant son mot de passe actuel.
Un code OTP à 6 chiffres est envoyé à l’adresse de son compte ; il expire après
10 minutes et cinq tentatives incorrectes au maximum sont autorisées. Le
changement n’est appliqué qu’après confirmation du code. Configurez les
variables SMTP décrites dans `.env.example` pour permettre l’envoi des codes.

## Facebook / Meta

La rubrique `/facebook` du frontend permet aux administrateurs de configurer le
message d’accueil. Les publications se font depuis `/produits`. Les demandes
reconnues par mots-clés démarrent un parcours pour un seul produit. Si un message
demande plusieurs produits, le client est invité à envoyer une demande distincte
pour chaque produit. Aucun paiement n’est effectué automatiquement.

Une question sur la disponibilité d’un produit reçoit d’abord une réponse avec
sa description, son prix et le stock disponible, puis demande la quantité
souhaitée. Avant de créer une commande, le bot recueille le téléphone et
l’adresse de livraison, présente un récapitulatif (article, quantité, prix
unitaire et coordonnées), puis attend une confirmation explicite. Aucune
commande ni réservation de stock n’est créée avant cette confirmation.
Les publications produits incluent leur description et leur prix dans la
légende.

Les commandes conservent le téléphone et l’adresse de livraison fournis par le
client, ainsi que la date/heure à laquelle elles sont marquées comme livrées.
Les webhooks Facebook ne fournissent pas automatiquement ces informations :
le bot les demande dans la conversation avant de créer la commande.

Pour activer l’intégration :

1. Configurez une application Meta avec les produits Messenger et Webhooks, puis
   liez-y votre Page et accordez les permissions requises par Meta. Pour publier
   des publications et des photos sur la Page, utilisez `pages_manage_posts`.
2. Dans Graph API Explorer, générez un jeton utilisateur avec `pages_show_list`
   et `pages_manage_posts`, puis récupérez l’ID de la Page et son jeton d’accès
   Page (par exemple via `/me/accounts`).
3. Renseignez côté serveur `FACEBOOK_APP_SECRET`, `FACEBOOK_VERIFY_TOKEN`,
   `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` et
   `FACEBOOK_GRAPH_API_VERSION`.
4. Configurez le webhook sur
   `https://<votre-api>/facebook/webhook`, avec les champs Page `feed`,
   `live_comments` et `messages`.

`FACEBOOK_VERIFY_TOKEN` est une valeur secrète de votre choix, à saisir aussi
dans la configuration du webhook Meta. Gardez tous les jetons et secrets dans
les variables d’environnement du serveur ; ne les publiez pas et ne les mettez
pas dans le frontend. Meta peut demander une revue de l’application et un accès
avancé pour les utilisateurs hors des rôles de test.

Après avoir modifié les permissions de l’application, générez un nouveau jeton
d’accès Page et remplacez `FACEBOOK_PAGE_ACCESS_TOKEN`. Les autorisations
nécessaires aux webhooks et à Messenger sont distinctes ; vérifiez-les selon les
fonctionnalités utilisées dans la documentation Meta.

Les publications organiques peuvent inclure un lien `m.me` vers la conversation
Messenger de la Page. Elles ne prennent pas en charge le bouton natif
« Envoyer un message » via l’API utilisée.

Lorsqu’une commande Facebook est confirmée, le nom fourni avec un commentaire
est enregistré directement. Pour une commande passée dans Messenger, le serveur
tente de récupérer le nom du profil à partir de l’identifiant de conversation
Page-scoped, avec `pages_messaging`. Cette information dépend de l’accès au
profil accordé à l’application par Meta ; si elle n’est pas disponible, la
commande reste enregistrée avec les autres coordonnées fournies par le client.

Pour un commentaire, le serveur utilise d’abord la réponse privée
`/{comment-id}/private_replies`. Si Meta refuse cette réponse, il tente ensuite
un DM Messenger vers l’identifiant du commentateur. La souscription webhook doit
inclure `feed` avec `comment` et les autorisations Page nécessaires doivent être
accordées et approuvées. Après une modification des permissions, un nouveau jeton
d’accès Page est nécessaire.

Le message automatique par défaut accueille le client et lui demande quel
produit il souhaite commander. La migration met à jour ce message seulement
s’il correspond encore à l’ancien texte par défaut ; un message personnalisé
dans les réglages Facebook est conservé.

## Vérification

```bash
npm run build
npm run lint
npm test
```

Pour les détails de configuration, consultez `.env.example`.
