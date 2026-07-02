export interface IRepository<T> {
  findMany(args?: any): Promise<T[]>;
  findUnique(id: string): Promise<T | null>;
  create(data: any): Promise<T>;
  update(id: string, data: any): Promise<T>;
  delete(id: string): Promise<T>;
}

export interface IService<T> {
  findMany(args?: any): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(data: any, author?: string): Promise<T>;
  update(id: string, data: any, author?: string): Promise<T>;
  delete(id: string, author?: string): Promise<T>;
  reorder?(orderedIds: string[]): Promise<void>;
  toggleVisibility?(id: string, isVisible: boolean): Promise<T>;
}
