ah oui mon probleme c'etait aussi de gérer les deux dans ma lib, version web et version locale
ChatGPT a dit :

C’est exactement la douleur classique : un seul code, mais deux mondes incompatibles :

Node → .node bindings, sync, chemin système, pas de CORS, pas de WASM

Web → .wasm, async, CORS, contexte bundler bizarre

La bonne façon de survivre est de débrancher la stratégie de chargement derrière un adapter.

Tu n’essaies pas d’avoir une seule implémentation magique.
Tu fais deux implémentations distinctes, avec la même interface, et tu laisses l’environnement choisir.

Ta lib doit avoir cette forme mentale :
import { createTreeSitter } from "tree-sitter-bridge";

const ts = await createTreeSitter({
  language: "typescript",
});


Et derrière createTreeSitter :

si tu es en Node → charge version native (sync)

si tu es en Browser → charge WASM + fetch

Comment le détecter proprement
1) Au runtime
const isBrowser =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined";


ou plus moderne :

if (typeof globalThis.window !== "undefined") {
  // browser
} else {
  // node
}

2) Structure de dossiers
src/
  adapters/
    node.ts
    web.ts
  create-tree-sitter.ts

3) L’interface commune
export interface TreeSitterInstance {
  parse(code: string): Tree;
}

4) Adapter côté Node
import Parser from "tree-sitter";
import Lang from "tree-sitter-typescript";

export async function createTreeSitterNode(): Promise<TreeSitterInstance> {
  const parser = new Parser();
  parser.setLanguage(Lang);

  return {
    parse(code: string) {
      return parser.parse(code);
    }
  };
}


Points :

sync

charge .node bindings

zéro wasm

5) Adapter côté Web
import Parser from "web-tree-sitter";

export async function createTreeSitterWeb(): Promise<TreeSitterInstance> {
  await Parser.init({
    locateFile: (file) => `/tree-sitter.wasm`,
  });

  const Lang = await Parser.Language.load(`/tree-sitter-typescript.wasm`);

  const parser = new Parser();
  parser.setLanguage(Lang);

  return {
    parse(code: string) {
      return parser.parse(code);
    }
  };
}


Points :

async

explicit .wasm URLs

6) Le pont commun
export async function createTreeSitter(opts: { language: string }) {
  if (typeof window === "undefined") {
    return createTreeSitterNode();
  } else {
    return createTreeSitterWeb();
  }
}

7) Bundlers intelligents

Dans package.json :

"exports": {
  ".": {
    "browser": "./dist/browser.js",
    "default": "./dist/node.js"
  }
}


Ce que ça fait :

Webpack / Vite / Next → prennent la version browser

Node → prend la version node

Sans douleur.

8) BONUS qui t’évite des migraines
Donne des paths configurables
createTreeSitter({
  language: "typescript",
  wasmBasePath: "/tree-sitter/"
});


Dans web adapter :

await Parser.init({
  locateFile: file => `${opts.wasmBasePath}${file}`
});


Parce que sinon, les équipes front vont pleurer en prod quand le CDN change.

9) Résultat

Ton code utilisateur est propre :

const ts = await createTreeSitter({ language: "typescript" });
const tree = ts.parse(src);
console.log(tree.rootNode.toString());


Ça marche en Node

Ça marche en Web

Sans if/else dans l’API

10) Résumé avec un soupir

deux implémentations

même interface

runtime choose

bundler mapping facultatif

pas d’essayer d’avoir un seul « hack universel »

Tu dors mieux, ton agent de code dort mieux, et personne n’a à hurler contre WASM à 3h du matin dans une cuisine obscure.

Si tu veux, je peux t’écrire la lib minimale complète (TS + build config) et tu n’as plus qu’à copier dans ton repo.