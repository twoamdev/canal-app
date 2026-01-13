import { createImagePrimitive } from "./createImagePrimitive"
import { type Primitive } from "@/types/primitives";
import { createVideoPrimitive } from "./createVideoPrimitive";

type FileHandler = (file: File) => Primitive

const handlers: Record<string, FileHandler> = {
  image: () => createImagePrimitive(),
  video: () => createVideoPrimitive(),
}

export function createPrimitiveFromFile(file: File): Primitive {
  const category = file.type.split('/')[0];
  const handler = handlers[category];

  if (!handler) {
    throw new Error(`Unsupported file type: ${file.type}`);
  }

  return handler(file);
}
