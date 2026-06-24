import { createFileRoute } from "@tanstack/react-router";
import AnthemGame from "@/game/AnthemGame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anthem — A Journey Through Ayn Rand's Novella" },
      { name: "description", content: "A 3D interactive walk through Anthem by Ayn Rand. Discover the tunnel, the light, the forest, and the sacred word." },
      { property: "og:title", content: "Anthem — Interactive Story" },
      { property: "og:description", content: "Speedrun the story of Equality 7-2521 in 15 minutes, or soak it in for 30." },
    ],
  }),
  component: Index,
  ssr: false,
});

function Index() {
  return <AnthemGame />;
}
