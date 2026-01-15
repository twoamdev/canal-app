/**
 * Image Sequence Detection and Processing
 *
 * Detects image sequences from a list of files by finding patterns like:
 * - frame_000.png, frame_001.png, frame_002.png
 * - render.v2.0000.png, render.v2.0001.png
 * - shot_001.jpg, shot_002.jpg
 *
 * The pattern is: [base_name][separator][number][.extension]
 * Where the number is a sequence of digits immediately before the extension.
 */

export interface ImageSequenceFile {
  file: File;
  frameNumber: number;
  baseName: string;
  extension: string;
}

export interface DetectedSequence {
  /** Base name of the sequence (e.g., "frame_" or "render.v2.") */
  baseName: string;
  /** File extension (e.g., "png", "jpg") */
  extension: string;
  /** Sorted files in the sequence */
  files: ImageSequenceFile[];
  /** First frame number in the sequence */
  startFrame: number;
  /** Last frame number in the sequence */
  endFrame: number;
  /** Total number of frames */
  frameCount: number;
  /** Whether the sequence is continuous (no gaps) */
  isContinuous: boolean;
}

// Supported image extensions for sequences
const SEQUENCE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'exr']);

/**
 * Parse a filename to extract sequence information
 * Returns null if the file doesn't match the sequence pattern
 */
export function parseSequenceFilename(filename: string): {
  baseName: string;
  frameNumber: number;
  extension: string;
  paddingLength: number;
} | null {
  // Match pattern: anything + digits + . + extension
  // The digits must be immediately before the extension
  const match = filename.match(/^(.+?)(\d+)\.([a-zA-Z]+)$/);

  if (!match) {
    return null;
  }

  const [, baseName, frameStr, extension] = match;

  // Check if it's a supported image extension
  if (!SEQUENCE_EXTENSIONS.has(extension.toLowerCase())) {
    return null;
  }

  return {
    baseName,
    frameNumber: parseInt(frameStr, 10),
    extension: extension.toLowerCase(),
    paddingLength: frameStr.length,
  };
}

/**
 * Detect image sequences from a list of files
 * Groups files by their base name and extension, then validates they form a sequence
 */
export function detectImageSequences(files: File[]): DetectedSequence[] {
  // Group files by base name + extension
  const groups = new Map<string, ImageSequenceFile[]>();

  for (const file of files) {
    const parsed = parseSequenceFilename(file.name);
    if (!parsed) continue;

    const key = `${parsed.baseName}|${parsed.extension}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)!.push({
      file,
      frameNumber: parsed.frameNumber,
      baseName: parsed.baseName,
      extension: parsed.extension,
    });
  }

  // Convert groups to sequences (minimum 2 files to be considered a sequence)
  const sequences: DetectedSequence[] = [];

  for (const [, fileGroup] of groups) {
    if (fileGroup.length < 2) continue;

    // Sort by frame number
    fileGroup.sort((a, b) => a.frameNumber - b.frameNumber);

    const startFrame = fileGroup[0].frameNumber;
    const endFrame = fileGroup[fileGroup.length - 1].frameNumber;

    // Check if continuous (no gaps)
    const expectedCount = endFrame - startFrame + 1;
    const isContinuous = fileGroup.length === expectedCount;

    sequences.push({
      baseName: fileGroup[0].baseName,
      extension: fileGroup[0].extension,
      files: fileGroup,
      startFrame,
      endFrame,
      frameCount: fileGroup.length,
      isContinuous,
    });
  }

  // Sort sequences by frame count (largest first)
  sequences.sort((a, b) => b.frameCount - a.frameCount);

  return sequences;
}

/**
 * Get a display name for a sequence
 */
export function getSequenceDisplayName(sequence: DetectedSequence): string {
  const { baseName, extension, startFrame, endFrame } = sequence;
  // Remove trailing separators from base name for cleaner display
  const cleanBaseName = baseName.replace(/[._-]$/, '');
  return `${cleanBaseName} [${startFrame}-${endFrame}].${extension}`;
}

/**
 * Check if a list of files contains a potential image sequence
 * Quick check without full detection - useful for early filtering
 */
export function mayContainImageSequence(files: File[]): boolean {
  let sequenceFileCount = 0;

  for (const file of files) {
    if (parseSequenceFilename(file.name)) {
      sequenceFileCount++;
      if (sequenceFileCount >= 2) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the best sequence from a folder (the one with the most frames)
 * Returns null if no valid sequence is found
 */
export function getBestSequence(files: File[]): DetectedSequence | null {
  const sequences = detectImageSequences(files);
  return sequences.length > 0 ? sequences[0] : null;
}
