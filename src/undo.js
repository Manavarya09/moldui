export class UndoManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = 100;
  }

  push(entry) {
    this.undoStack.push(entry);
    this.redoStack = [];
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (entry) {
      this.redoStack.push(entry);
      return entry;
    }
    return null;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (entry) {
      this.undoStack.push(entry);
      return entry;
    }
    return null;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.redoStack = []; }
}
