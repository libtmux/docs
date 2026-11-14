Quote two lines of the program.

```go excerpt="main.go" from="b := 2" to="c := 3"
```

Quote one line under a title of its own.

```go title="step.go" excerpt="main.go" from="a := 1"
```

The program the excerpts quote.

```go title="main.go"
package main

import "fmt"

func main() {
	a := 1
	b := 2
	c := 3
	fmt.Println(a, b, c)
}
```

A file that is not quoted.

```text title="go.mod"
module example.com/demo
```

A role the author chose.

```yaml title="config.yaml" role="program"
name: demo
```

A command.

```console
$ go run .
```
