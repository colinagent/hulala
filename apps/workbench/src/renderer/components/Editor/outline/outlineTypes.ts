export type OutlineNode = {
  id: string;
  label: string;
  depth: number;
  hasChildren: boolean;
  parentId: string | null;
  ancestorIds: string[];
};
