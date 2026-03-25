# flowable api xml json converter
flowable-api-xml-json-converter API
## github
https://github.com/rustquery/flowable-api-xml-json-converter
## json to xml
```
curl -X POST http://localhost:3111/json-to-xml -H "Content-Type: application/json" -d @example-1.json | jq -r '.xml' > output-1.bpmn20.xml
```
## xml to json
```
jq -Rs '{ xml: . }' output-1.bpmn20.xml | curl -X POST http://localhost:3111/xml-to-json   -H "Content-Type: application/json" -d @- | jq '.' > output-1.json
```
