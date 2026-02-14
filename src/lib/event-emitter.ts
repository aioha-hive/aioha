import { Events } from '../types.js'

export class SimpleEventEmitter<E extends string = Events> {
  private events: {
    [eventName: string]: Function[]
  } = {}

  private eventOnce: {
    [eventName: string]: Function[]
  } = {}

  constructor() {}

  on(eventName: E, listener: Function) {
    if (!this.events[eventName]) {
      this.events[eventName] = [listener]
    } else {
      this.events[eventName].push(listener)
    }
  }

  once(eventName: E, listener: Function) {
    if (!this.eventOnce[eventName]) {
      this.eventOnce[eventName] = [listener]
    } else {
      this.eventOnce[eventName].push(listener)
    }
  }

  off(eventName: E, listener?: Function) {
    if (!listener) {
      delete this.events[eventName]
    } else {
      for (let l in this.events[eventName]) {
        if (this.events[eventName][l] === listener) {
          this.events[eventName].splice(parseInt(l), 1)
          break
        }
      }
    }
  }

  emit(eventName: E, ...args: any[]) {
    for (let l in this.eventOnce[eventName]) {
      this.eventOnce[eventName][l](...args)
    }
    delete this.eventOnce[eventName]
    for (let l in this.events[eventName]) {
      this.events[eventName][l](...args)
    }
  }
}
