export type Estimate = "S" | "M" | "L" | "XL" | "XXL";

export interface Project {
  id: string;
  name: string;
  category: string;
  estimate: Estimate;
}
