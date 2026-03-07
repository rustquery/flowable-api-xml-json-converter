import { XMLBuilder, XMLParser } from "fast-xml-parser"
import { addIfNotNull } from "./add-if-not-null"
import { ENavigationMode, EVertexType, IChildShape, IFlowableBpmnJson, INodeProperties, IResourceReference, ISequenceFlowNodeProperties } from "@supdigest/digest-convert-types"

interface IFlowableField {
    "name": string,
    "flowable:string": string,
}

interface IXMLSequenceFlow {
    id?: string
    sourceRef: string
    targetRef: string
    name?: string
    conditionExpression?: {
        "#text"?: string,
    }
}

interface IXMLElement {
    id: string
    name?: string
    documentation?: string
    extensionElements?: {
        "flowable:field"?: IFlowableField | IFlowableField[],
    }
    "flowable:type"?: string
    "flowable:assignee"?: string
    "flowable:candidateGroups"?: string
    "flowable:candidateUsers"?: string
    nodeType?: EVertexType
}

interface IXMLProcess {
    id: string
    name?: string
    startEvent?: IXMLElement | IXMLElement[]
    userTask?: IXMLElement | IXMLElement[]
    sendTask?: IXMLElement | IXMLElement[]
    serviceTask?: IXMLElement | IXMLElement[]
    scriptTask?: IXMLElement | IXMLElement[]
    exclusiveGateway?: IXMLElement | IXMLElement[]
    endEvent?: IXMLElement | IXMLElement[]
    sequenceFlow?: IXMLSequenceFlow | IXMLSequenceFlow[]
}

interface IXMLRoot {
    definitions: {
        process: IXMLProcess
    }
}

// Helper para garantir que sempre teremos um array, mesmo com 1 elemento no XML
const ensureArray = <T,>(item: T | T[] | undefined): T[] => {
    if (!item) {
        return []
    }
    if (Array.isArray(item)) {
        return item
    }
    return [item]
}

const assigneeType = (type: EVertexType) => (item: IXMLElement) => {
    return {
        ...item,
        nodeType: type,
    }
}

const getFlowableFieldValue = (el: IXMLElement, fieldName: string): string | undefined => {
       
    const fields = el.extensionElements?.["flowable:field"] ?? []
    const properties = el.extensionElements?.["flowable:properties"]?.["flowable:field"] ?? []
    
    const fieldsArray = Array.isArray(fields) ? fields : [fields]
    const propsArray = Array.isArray(properties) ? properties : [properties]
    const targetField = [
        ...fieldsArray,
        ...propsArray,
    ].find(f => f["name"] === fieldName)

    if(!targetField){
        return undefined
    }

    return targetField["flowable:string"] || targetField["flowable:expression"] || targetField["flowable:property"]
}


function convertBpmnXmlToFlowableJson(xml: string): IFlowableBpmnJson {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        processEntities: true
    })

    const jsonObj = parser.parse(xml) as IXMLRoot
    const process = jsonObj.definitions.process

    // 1. Mapeia Elementos (Nodes)
    const rawElements: IXMLElement[] = [
        ...ensureArray(process.startEvent).map(assigneeType(EVertexType.START)),
        ...ensureArray(process.userTask).map(assigneeType(EVertexType.USER_TASK)),
        ...ensureArray(process.sendTask).map(assigneeType(EVertexType.SEND_TASK)),
        ...ensureArray(process.serviceTask).map(assigneeType(EVertexType.SERVICE_TASK)),
        ...ensureArray(process.scriptTask).map(assigneeType(EVertexType.SCRIPT_TASK)),
        ...ensureArray(process.exclusiveGateway).map(assigneeType(EVertexType.EXCLUSIVE_GATEWAY)),
        ...ensureArray(process.endEvent).map(assigneeType(EVertexType.END)),
    ]

    const allFlows = ensureArray(process.sequenceFlow)

    const nodeShapes = rawElements.map((el): IChildShape<INodeProperties> => {
        const props: INodeProperties = {
            overrideId: el.id,
            name: el.name,
            processId: el.id,
            nodeType: el.nodeType,
            prototypeId: el.id,
            ...addIfNotNull("documentation", el.documentation),
        }

        const candidateGroups = el["flowable:candidateGroups"] || ""
        const candidateUsers = el["flowable:candidateUsers"] || ""

        if (el["flowable:assignee"] || el["flowable:candidateGroups"] || el["flowable:candidateUsers"]) {
            props.userTaskAssignment = {
                assignment: {
                    assignee: el["flowable:assignee"],
                    type: "idm",
                    candidateGroups: candidateGroups.length ? candidateGroups.split(",") : [],
                    candidateUsers: candidateUsers.length ? candidateUsers.split(",") : [],
                }
            }
        }

        if(el.nodeType === EVertexType.USER_TASK){
            props.target = {
                ...addIfNotNull("documentDefinitionId", getFlowableFieldValue(el, "documentDefinitionId")),
                ...addIfNotNull("uri", getFlowableFieldValue(el, "targetUrl")),
                navigationMode: (getFlowableFieldValue(el, "navigationMode") || ENavigationMode.EXTERNAL) as ENavigationMode,
            }
        }

        if(el.nodeType === EVertexType.SEND_TASK){
            props.sendTaskConfig = {
                operation: "mail",
                ...addIfNotNull("target", getFlowableFieldValue(el, "to")),
                ...addIfNotNull("subject", getFlowableFieldValue(el, "subject")),
                ...addIfNotNull("text", getFlowableFieldValue(el, "text")),
            }
        }

        if(el.nodeType === EVertexType.SERVICE_TASK){
            props.serviceTaskConfig = {
                 operation: "html",
                 saveResponseVariableAsJson: !!getFlowableFieldValue(el, "saveResponseVariableAsJson"),
                ...addIfNotNull("uri", getFlowableFieldValue(el, "requestUrl")),
                // ...addIfNotNull("serviceProtocol", getFlowableFieldValue(el, "serviceProtocol")),
                ...addIfNotNull("method", getFlowableFieldValue(el, "requestMethod")),
                ...addIfNotNull("responseVariableName", getFlowableFieldValue(el, "responseVariableName")),
            }
        }

        if(el.nodeType === EVertexType.SCRIPT_TASK){
            props.scriptTaskConfig = {
                resultVariable: getFlowableFieldValue(el, "resultVariable"),
                scriptFormat: el["scriptFormat"] || el["@_scriptFormat"],
                scriptContent: el["script"] || getFlowableFieldValue(el, "script"),
            }
        }

        return {
            resourceId: el.id,
            stencil: { id: el.nodeType as EVertexType },
            properties: props,
            bounds: {
                lowerRight: { x: 0, y: 0 },
                upperLeft: { x: 0, y: 0 }
            },
            outgoing: findOutgoingRefs(allFlows, el.id)
        }
    })

    const flowShapes = allFlows.map((flow): IChildShape<ISequenceFlowNodeProperties> => {
        const flowId = flow.id || `flow_${flow.sourceRef}_${flow.targetRef}`
        return {
            resourceId: flowId,
            stencil: { id: EVertexType.SEQUENCE_FLOW },
            properties: {
                prototypeId: flowId,
                name: flow.name,
                nodeType: EVertexType.SEQUENCE_FLOW,
                ...addIfNotNull("conditionExpression", flow.conditionExpression?.["#text"]),
            },
            dockers: [
                { x: 50, y: 50 },
                { x: 50, y: 50 }
            ],
            outgoing: [
                { resourceId: flow.targetRef }
            ]
        }
    })

    return {
        resourceId: process.id,
        stencil: { id: "BPMNDiagram" },
        properties: {
            processId: process.id,
            name: process.name
        },
        childShapes: [...nodeShapes, ...flowShapes],
        bounds: {
            lowerRight: { x: 1200, y: 1200 },
            upperLeft: { x: 0, y: 0 }
        }
    }
}


function findOutgoingRefs(flows: IXMLSequenceFlow[], sourceId: string): IResourceReference[] {
    const refs: IResourceReference[] = []

    for (const flow of flows) {
        if (flow.sourceRef === sourceId) {
            const flowId = flow.id || `flow_${flow.sourceRef}_${flow.targetRef}`
            refs.push({ resourceId: flowId })
        }
    }

    return refs
}


const convertBPMNJsonToXML = (template: IFlowableBpmnJson) => {
    // 1. Tratativa para o Process ID (Fallback caso não exista)
    // Prioridade: properties.process_id -> resourceId -> 'default_process'
    const processId = template.resourceId || `process_${Date.now()}`
    const processName = template?.properties?.name || "Untitled Process"

    const childShapes = template
        .childShapes
        .map(s => ({
            ...s.properties,
        }))
    // 2. Extração de Elementos

    const mapTransform = (s: INodeProperties) => ({
        '@_id': s.prototypeId,
        '@_name': s.name,
        ...addIfNotNull("documentation", s.documentation),
    })

    const startEvents = childShapes
        .filter(s => s.nodeType === EVertexType.START)
        .map(mapTransform)

    const endEvents = childShapes
        .filter(s => s.nodeType === EVertexType.END)
        .map(mapTransform)

    const userTasks = childShapes
        .filter(s => s.nodeType === EVertexType.USER_TASK)
        .map((s:INodeProperties) => ({
            '@_id': s.prototypeId,
            '@_name': s.name,
            "@_flowable:formKey": s?.target?.uri || s?.target?.documentDefinitionId || "",
            ...addIfNotNull("documentation", s.documentation),
            ...addIfNotNull("@_flowable:assignee", s.userTaskAssignment?.assignment?.assignee),
            ...addIfNotNull("@_flowable:candidateGroups", s.userTaskAssignment?.assignment?.candidateGroups?.length > 0 ? s.userTaskAssignment.assignment.candidateGroups.join(",") : undefined),
            ...addIfNotNull("@_flowable:candidateUsers", s.userTaskAssignment?.assignment?.candidateUsers?.length > 0 ? s.userTaskAssignment.assignment.candidateUsers.join(",") : undefined),
            
            ...(s?.target?.uri || s?.target?.documentDefinitionId ? {
                extensionElements: {
                    "flowable:properties":{
                        "flowable:field": [
                            ...(s.target.uri ? [{
                                "@_name": "targetUrl",
                                "flowable:expression": {
                                    "__cdata":s.target.uri || "",
                                },
                            }]: []),
                            ...(s.target.documentDefinitionId ? [{
                                "@_name": "documentDefinitionId",
                                "flowable:property": s.target.documentDefinitionId,
                            }]: []),
                            {
                                "@_name": "navigationMode",
                                "flowable:property": s.target.navigationMode ?? ENavigationMode.EXTERNAL,
                            }
                        ]
                    }
                },
            } : {})
        }))

    const serviceTasks = childShapes
        .filter(s => s.nodeType === EVertexType.SERVICE_TASK)
        .map((s:INodeProperties) => ({
            '@_id': s.prototypeId,
            '@_name': s.name,
            ...addIfNotNull("documentation", s.documentation),
            '@_flowable:type': 'http',
            extensionElements: {
                "flowable:field": [
                    {
                        "@_name": "requestMethod",
                        "flowable:string": s.serviceTaskConfig?.method,
                    },
                    {
                        "@_name": "requestUrl",
                        "flowable:expression": {
                            "__cdata": s.serviceTaskConfig?.uri,
                        },
                    },
                    {
                        "@_name": "requestHeaders",
                        "flowable:string": {
                            "__cdata": "Accept: application/json\nContent-Type: application/json",
                        },
                    },
                    {
                        "@_name": "saveResponseVariableAsJson",
                        "flowable:string": s.serviceTaskConfig?.saveResponseVariableAsJson ? "true" : "false",
                    },
                    {
                        "@_name": "saveResponseParameters",
                        "flowable:string": "false",
                    },
                    {
                        "@_name": "responseVariableName",
                        "flowable:string": s.serviceTaskConfig?.responseVariableName || "restResultData"
                    }
                ]
            },
        }))

    const sendTasks = childShapes
        .filter(s => s.nodeType === EVertexType.SEND_TASK)
        .map((s:INodeProperties) => ({
            '@_id': s.prototypeId,
            '@_name': s.name,
            ...addIfNotNull("documentation", s.documentation),
            '@_flowable:type': "mail",
            '@_flowable:async': true,
            extensionElements: {
                "flowable:field": [
                    {
                        "@_name": "to",
                        "flowable:expression": {
                            "__cdata":s.sendTaskConfig?.target || "example@dominio.com",
                        },
                    },
                    {
                        "@_name": "subject",
                        "flowable:expression": {
                            "__cdata":s.sendTaskConfig?.subject || "process notification",
                        },
                    },
                    {
                        "@_name": "text",
                        "flowable:expression": {
                            "__cdata":s.sendTaskConfig?.text || "default text.",
                        },
                    },
                ]
            },
        }))

    const scriptTasks = childShapes
        .filter(s => s.nodeType === EVertexType.SCRIPT_TASK)
        .map((s:INodeProperties) => ({
            '@_id': s.prototypeId,
            '@_name': s.name,
            ...addIfNotNull("documentation", s.documentation),
            '@_scriptFormat': s.scriptTaskConfig?.scriptFormat || "javascript",
            '@_flowable:resultVariable': s.scriptTaskConfig?.resultVariable || "resultVariable",
            'script': {
                "__cdata": s.scriptTaskConfig?.scriptContent,
            },
        }))

    const exclusiveGateways = childShapes
        .filter(s => s.nodeType === EVertexType.EXCLUSIVE_GATEWAY)
        .map(mapTransform)

    const sequenceFlows = template
        .childShapes
        .filter(s => s.stencil.id === EVertexType.SEQUENCE_FLOW)
        .map(s => {           
            const source = template
                .childShapes.find(shape =>
                    shape.outgoing?.some(out => out.resourceId === s.resourceId)
                )

            const targetRef = s.outgoing?.[0]?.resourceId
            const currProps = s.properties as ISequenceFlowNodeProperties
            const seqProps = {
                '@_id': s.resourceId,
                '@_sourceRef': source?.resourceId || 'unknown_source',
                '@_targetRef': targetRef || 'unknown_target',
                ...addIfNotNull('@_name', currProps.name),
            }

            if(currProps.conditionExpression){
                seqProps["conditionExpression"] = {
                    "@_xsi:type": "tFormalExpression",
                    "__cdata": currProps.conditionExpression,
                }
            }

            return seqProps
        })
        .filter(item => item["@_sourceRef"] !== 'unknown_source' && item["@_targetRef"] !== 'unknown_target')

    // 4. Montagem da Estrutura BPMN
    const bpmnObject = {
        definitions: {
            '@_xmlns': 'http://www.omg.org/spec/BPMN/20100524/MODEL',
            '@_targetNamespace': 'http://flowable.org/bpmn',
            "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@_xmlns:flowable": "http://flowable.org/bpmn",
            process: {
                '@_id': processId,
                '@_name': processName,
                '@_isExecutable': 'true',
                startEvent: startEvents,
                userTask: userTasks,
                serviceTask: serviceTasks,
                sendTask: sendTasks,
                scriptTask: scriptTasks,
                exclusiveGateway: exclusiveGateways,
                sequenceFlow: sequenceFlows,
                endEvent: endEvents,
            }
        }
    }

    const builder = new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        attributeNamePrefix: "@_",
        cdataPropName: "__cdata",
        suppressEmptyNode: true,
        suppressBooleanAttributes: false,
    })

    return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(bpmnObject)}`
}


export {
    convertBPMNJsonToXML, convertBpmnXmlToFlowableJson
}