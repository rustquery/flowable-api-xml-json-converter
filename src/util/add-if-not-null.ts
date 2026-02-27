const addIfNotNull = (key: string, value?: string) =>
    value !== null && value !== undefined ? { [key]: value } : {}

export { addIfNotNull }