import type { UIStrings } from "../types";

export default {
  nav: {
    home: "Accueil",
    posts: "Articles",
    tags: "Tags",
    about: "Bio",
    archives: "Archives",
    search: "Rechercher",
  },
  post: {
    publishedAt: "Publié le",
    updatedAt: "Mis à jour",
    sharePostIntro: "Partager cet article :",
    sharePostOn: "Partager cet article sur {{platform}}",
    sharePostViaEmail: "Partager cet article par email",
    tagLabel: "Tags",
    backToTop: "Retour en haut",
    goBack: "Retour",
    editPage: "Modifier la page",
    previousPost: "Article précédent",
    nextPost: "Article suivant",
  },
  pagination: {
    prev: "Précédent",
    next: "Suivant",
    page: "Page",
  },
  home: {
    socialLinks: "Liens",
    featured: "À la une",
    recentPosts: "Articles récents",
    allPosts: "Tous les articles",
  },
  footer: {
    copyright: "Copyright",
    allRightsReserved: "Tous droits réservés.",
  },
  pages: {
    tagTitle: "Tag",
    tagDesc: "Tous les articles avec le tag",

    tagsTitle: "Tags",
    tagsDesc: "Tous les tags utilisés dans les articles.",

    postsTitle: "Articles",
    postsDesc: "Tous les articles publiés.",

    archivesTitle: "Archives",
    archivesDesc: "Tous les articles archivés.",

    searchTitle: "Rechercher",
    searchDesc: "Rechercher un article...",
  },
  a11y: {
    skipToContent: "Aller au contenu",
    openMenu: "Ouvrir le menu",
    closeMenu: "Fermer le menu",
    toggleTheme: "Changer le thème",
    searchPlaceholder: "Rechercher des articles...",
    noResults: "Aucun résultat",
    goToPreviousPage: "Page précédente",
    goToNextPage: "Page suivante",
  },
  notFound: {
    title: "404 Page introuvable",
    message: "Page introuvable",
    goHome: "Retour à l'accueil",
  },
} satisfies UIStrings;
