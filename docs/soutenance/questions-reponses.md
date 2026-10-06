# Entraînement Q&A — deux cours

Questions d'entraînement construites à partir des critères et TP ; **ce n'est pas la banque officielle des 16 questions du professeur**, non fournie dans les grilles. Pour chaque réponse : notion exacte → exemple Pagespace → limite/conséquence. Faire travailler 2 fondamentaux [F] et 2 cas [C] de chaque cours. Les questions à deux volets exigent les deux réponses.

## Web temps réel — fondamentaux

**[F] Pourquoi Socket.IO ?** Le flux d'édition est bidirectionnel : opérations client→serveur et diffusion aux autres. Rooms, acknowledgements et reconnexion facilitent le contrôle. Socket.IO est un protocole applicatif utilisant notamment WebSocket, pas un client WS brut interchangeable. SSE convient au push unidirectionnel mais exigerait un canal POST séparé pour écrire ; WebRTC pair-à-pair ne fournit pas à lui seul notre autorité serveur/ACL.

**[F] À quoi sert une room ?** `doc:<id>` est le groupe de diffusion d'un document. Le serveur valide le propriétaire/collaborateur avant join et avant opération. Le nom ne constitue pas un secret ni une autorisation ; connaître doc-brief ne donne aucun droit.

**[F] Pourquoi une grâce de présence ?** Une coupure courte ne doit pas annoncer faussement un départ. ClientId stable par onglet et userId identifient la présence ; reconnexion avant 5 s reprend le membre. Après expiration, un seul presence-left. Un crash non signalé dépend du bail 15 s en cluster.

**[F] Pourquoi les offsets divergent-ils ?** Une insertion change les offsets des caractères suivants. Deux répliques qui appliquent des opérations sur des offsets calculés avant une autre modification peuvent produire des textes différents. Le CRDT identifie une position stable, impose un ordre total des insertions concurrentes et déduplique.

**[F] Snapshot, delta et tombstone ?** Snapshot : état complet avec positions et suppressions connues, utilisé à la connexion. Delta : opérations supplémentaires ; leur renvoi ne doit pas dupliquer. Tombstone : preuve d'une suppression, qui empêche une insertion tardive de ressusciter le caractère. Texte seul ≠ état CRDT complet.

**[F] Redis adapte-t-il seul la cohérence ?** L'adaptateur Socket.IO diffuse entre instances, il ne remplace pas le stockage documentaire. RedisState conserve état CRDT, révision, SSE et présence ; mises à jour atomiques évitent d'écraser l'écriture concurrente d'une autre instance. L'affinité nginx sert surtout au polling Engine.IO.

**[F] Last-Event-ID ?** Le client SSE annonce le dernier ID reçu. Les événements plus récents du buffer sont rejoués pour son document autorisé. Buffer commun de 100 événements ; si trop ancien, resync-needed puis recharge snapshot. Ce n'est pas une garantie de conservation infinie.

**[F] Quelle preuve de convergence ?** Même snapshot AB, insertions X/Y préparées indépendamment, livraisons différentes ; tous gardent les deux caractères dans le même ordre final. Test des doublons, suppression avant insertion, tombstones et snapshot tardif. Une égalité sur un seul exemple ne prouve pas formellement toutes les propriétés du CRDT.

## Web temps réel — cas limites

**[C] Deux instances reçoivent une édition en même temps ?** Chaque opération possède une position stable ; la transaction compare la révision partagée. Si elle a changé, recharger et réappliquer le lot avant sauvegarde atomique. Pub/sub seul ne règle pas l'écrasement d'état.

**[C] Un client renvoie après un timeout ?** Un timeout ne prouve pas que le serveur n'a rien appliqué. Rejouer les mêmes identifiants doit être idempotent ; générer de nouvelles opérations risquerait de doubler. Le snapshot avec tombstones permet une reprise correcte ; notre UI revient au snapshot en cas de confirmation incertaine.

**[C] Redis tombe ?** Le service partagé devient dégradé et refuse les écritures échouées ; ne pas basculer silencieusement vers deux mémoires indépendantes. Au démarrage REDIS_URL sans Redis provoque un échec explicite. Redis reste un point commun non hautement disponible ; AOF n'est pas une sauvegarde contre perte de disque.

**[C] Le buffer SSE est dépassé ?** Annoncer resync-needed, récupérer l'état autorisé puis reprendre ; ne pas inventer les deltas manquants. Pour un canal d'édition, il faut l'état CRDT et les suppressions, pas seulement le texte affiché.

**[C] Peut-on supprimer les tombstones ?** Oui seulement après un compactage avec horizon de synchronisation et règle obligeant les clients trop anciens à reprendre un snapshot. Sinon un client hors ligne peut réintroduire une insertion supprimée. Notre prototype ne réalise pas ce compactage : F-05.

**[C] Un user ouvre deux onglets ?** Même userId, clientId différents : deux présences distinctes, identité d'auteur identique. Les clientId ne sont pas une preuve d'identité et sont bornés en longueur. La reconnexion d'un onglet reprend son propre membre.

**[C] Le site d'une position CRDT peut-il être forgé ?** L'utilisateur autorisé maîtrise encore ses entrées ; validation structure/taille/débit et auteur serveur limitent les abus. Une propriété de convergence ne suffit pas à garantir la bonne intention des éditions. Quotas/journal et politique de droits complètent l'approche.

**[C] Pourquoi mesurer p95 plutôt que moyenne seulement ?** La moyenne peut masquer les clients lents ; p95 décrit la latence dépassée par 5 % des observations. Préciser ce qui est mesuré (handshake client ou serveur), la charge et le matériel ; les captures de charge TP7 ne sont pas un SLO garanti.

## Sécurité — fondamentaux

**[F] STRIDE et EBIOS, deux rôles ?** STRIDE classe les menaces techniques (S,T,R,I,D,E) sur composants/flux. BE/ER décrivent valeur et impact métier. S-01 relie une lecture REST non autorisée à BE1 et ER1 ; une lettre STRIDE seule ne donne pas une priorité.

**[F] Trust boundary ?** Endroit où la confiance change : navigateur→serveur, app→Redis, dépôt→runner. Les entrées franchissant TB1 restent non fiables même après connexion. Origin n'est pas une identité ; JWT n'autorise pas tous les documents.

**[F] SAST/SCA/DAST/secrets/image ?** SAST lit le code, SCA rapproche versions d'advisories, DAST observe le service lancé, secrets recherche des valeurs exposées, image analyse packages système/app du runtime. Ils ne couvrent pas tous les mêmes défauts ; ZAP baseline ne prouve pas l'ACL.

**[F] Qu'est-ce qu'un seuil explicite ?** Un step nommé lit les rapports avec une politique versionnée et décide. Notre gate bloque SAST ERROR, secrets non qualifiés, npm/image HIGH/CRITICAL, OSV haute/inconnue et ZAP Medium+/FAIL. Un rapport absent/invalide échoue ; un continue-on-error seul ne fait pas une politique.

**[F] Vrai positif, faux positif, risque accepté ?** Vrai : la condition détectée existe. Faux : l'outil se trompe, preuve à l'appui. Accepté : la condition existe mais son risque est assumé avec portée/responsable/date. L'ancienne clé dans Git est un vrai positif historique invalidé, pas un faux positif ; seule son empreinte est qualifiée.

**[F] JWT signé protège-t-il la confidentialité ?** Non : le payload est lisible ; signature/authenticité et chiffrement sont distincts. HS256 utilise un secret partagé. Vérifier algorithme, issuer, audience, exp et sub ; connaître la clé annule l'authenticité. TLS protège le transport, HSTS impose HTTPS dans un contexte de navigateur compatible.

**[F] Correctif de conception vs rustine ?** Filtrer l'objet chargé avec l'identité sur tous les lecteurs supprime le défaut commun. Masquer le brief dans l'UI laisse REST/SSE ouverts. L'ADR nomme les options rejetées et le risque résiduel.

**[F] SBOM, USER et layers ?** SBOM inventorie les composants, il ne prouve pas leur sécurité. USER 65532 numérique fonctionne dans distroless sans dépendre d'un compte nommé node. Supprimer un fichier secret dans un layer ultérieur ne retire pas le contenu du layer initial ; ne jamais le copier ou le déclarer dans un ENV d'image.

## Sécurité — cas limites

**[C] Pipeline vert mais fuite de brief ?** La vulnérabilité d'autorisation peut échapper aux scanners. Reproduire l'accès et relier à S-01 ; test négatif de chaque lecteur, correctif au chargement, nouveau contrôle. Vert signifie politiques mesurées respectées, pas preuve exhaustive de sûreté.

**[C] npm et OSV donnent des chiffres différents ?** Même lockfile, bases/advisories et agrégation différentes. Comparer paquet/version/identifiant, notamment deux versions de fast-uri, pas additionner 4 paquets npm et 11 signalements OSV. Vérifier date et versions des outils.

**[C] Secret retiré, Gitleaks encore rouge ?** Fetch-depth 0 analyse le commit ancien. Révoquer/rotater, vérifier qu'aucun service ne l'accepte, puis qualifier exactement l'empreinte historique si justifié. Effacer le fichier ne révoque rien ; une nouvelle occurrence doit toujours bloquer.

**[C] CORS restreint suffit-il aux WS ?** Non, il faut vérifier Origin du handshake WS et authentifier. Un script non navigateur peut omettre/forger Origin ; le JWT reste obligatoire et ACL par document. CSP/XSS et vol de jeton restent des risques séparés.

**[C] Le JWT expire pendant la connexion ?** Le handshake ne se rejoue pas automatiquement. Notre timeout ferme le socket et le SSE à exp ; en service réel, prévoir renouvellement contrôlé et révocation. Expiration limitée ≠ déconnexion immédiate d'un token révoqué avant exp.

**[C] Une alerte CRITICAL de dépendance est-elle toujours le premier travail ?** Elle bloque le scan ; qualifier exposition et exploitabilité, mais une fuite anonyme BE1 prouvée peut être P0 avant un outil dev sans entrée externe. SEC-2 fournit critères et impose une exception revue si on diffère ; pas d'ignore global.

**[C] Le registre dit “7 jours”, Redis ne purge pas ?** Ce serait une déclaration fausse. Notre registre dit persistance sans TTL actuellement et objectif proposé avant usage réel. Définir durée, implémenter purge/compactage, tester backups/AOF et demandes d'effacement. Base légale et durée dépendent du traitement, pas d'un formulaire rempli.

**[C] Nouvelle alerte CSP après correction ?** Une CSP présente peut révéler une exception jusque-là invisible. Qualifier la directive réellement permissive et l'impact. Ici script-src reste self ; style-src-attr inline pour curseurs est assumé/daté. Ne pas généraliser l'exception à tous les scripts ni accepter toutes les règles ZAP.

## Exercice oral

Tirer quatre questions par cours (2 F + 2 C), répondre en 45–60 secondes chacune puis donner une preuve du projet. Si deux volets sont demandés, annoncer les deux et traiter chacun. Pour un diagnostic hypothétique, proposer une hypothèse, un signal et un test ; ne pas inventer une instrumentation inexistante.
