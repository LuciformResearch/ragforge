- Projet généré juste avec quickstart et un argument qui pointe vers le bon projet de code et un argument typescript

- Chat, compression hiérarchique, réponses structurées, organisation/suivit d etapes, recherches web

- tout les filtres et expand possibles générés automatiquement avec une option

- .generateStructuredLLMAnswer(fieldsInfo, structureInfo)

Genere une réponse structurée, fields info contient un prompt par field à prendre en compte j'imagine et pareil structureInfo un prompt par membre de la structure à retourner

chatSession.chatTurn(userMessage)

Enregistre un chat turn pour un projet d exemple d agent de chat,

Génére automatiquement des résumés l1 l2 l3 etc quand nécessaire,

Génére des embeddings a la volée,

chatSession.rag()

chatSession.ragClient().chatTurns().semanticSearch('user' | 'assistant' | 'both', "semantic search")

chatSession.ragClient().l1Sumaries().semanticSearch("semantic search")

pareil pour l2, l3

SomeRagResult().Chain( lambda pour utiliser les résultat)

SomeRagResult().Traverse( lambda pour chaque resultat)

La lib de chat prevoit que l agent de chat soit générique et non lié a un projet en particulier