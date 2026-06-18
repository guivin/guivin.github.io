import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://guivin.github.io",
    title: "Guivin",
    description:
      "Site Reliability Engineer : ce que je découvre au quotidien en construisant et en opérant des systèmes réels.",
    author: "Guillaume Vincent",
    profile: "https://github.com/guivin",
    lang: "fr",
    timezone: "Europe/Paris",
    dir: "ltr",
  },
  posts: {
    perPage: 5,
    perIndex: 5,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: true,
      url: "https://github.com/guivin/guivin.github.io/edit/main/src/content/posts/",
    },
    search: "pagefind",
  },
  socials: [
    { name: "github", url: "https://github.com/guivin" },
    { name: "linkedin", url: "https://www.linkedin.com/in/guivin/" },
  ],
  shareLinks: [],
});

