
PROJECT WEAVER:

on pourrait aussi imaginer un agent qui préparerait la normalisation de documents via (deepseek ocr) ou appache tika, ou autre librairies sympa comme ça si tu as des idées
vers des .md ou des documents xml ou tableaux csv selon les cas d'usage,

il aurait d'abord en phase 1 quelques outils pour convertir les fichiers en markdown, jusqu'a ce qu'il ai pu convertir un maximum de trucs, le reste il le traite avec deekseek ocr si il peut.

la il se décide à passer phase 2, il construit des résumés structurés qui contiennent le résumé du document traité + ses conseils sur comment faire un rag dessus + le type du fichier traité, pour chaque document en question.
la il se décide à passer phase 3, il constuit un résumé global itératif (genre traitant tel nombre de résumés l0 a la fois), et le relis et le compare a tout les petites suggestions de comment faire du rag dessus,
il décide selon chaque type de fichier l0 qu'il a résumé + suggestions de rag qui leur étaient propre, crée plusieurs nouveaux types de rag a utiliser, il les nomme comme il veut et donne leur description, 
assigne un de ces types de rag qu'il a choisi a chaque l0 qu'il a traité,
et tout ça dans sa réponse structuré, 

ensuite phase 4, sur chaque résumé structuré l1 qu'il a créé, il en relis tel nombre (de l1 structurés), re fais un résumé structuré l2, ou il re choisis a nouveau de nouveaux types de rag et leur description, s'inspirant des propositions dans les L1,
enfin, phase 4.1 ... etc... jusqu'a ce qu'on traite lX qui correspond a un seul résumé global, + les types de rag choisis, + leurs descriptions + une assignation d'un de ces types de rag a chaque l0 initiaux,

enfin, phase 5, il regroupe chaque l0 partageant le meme type de rag, et appel un agent de code spécialisé style gemini, pour lui demander de creer un script de traitement chunkage/llm vers xml structuré standard a la description du type de rag.
il applique ce script à tout les l0 partageant le meme type de rag, pour tout les types de rag, 
puis depuis ces xml on génére procéduralement un script d'ingestion neo4j, pour chaque type de rag,
on les ingère sur neo4j aussi tant qu'a faire,

et étape finale on génère une config et le framework pour faire le rag dessus.
puis on génère et branche un agent final de démonstration, spécialiste du framework qu'on vient de générer, a qui l'utilisateur peut poser des questions avoir les infos ce qu'il veut sur ses fichiers, tester que le rag est au top.


