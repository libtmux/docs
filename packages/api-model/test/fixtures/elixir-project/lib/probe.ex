defmodule Probe do
  @moduledoc """
  A module the exporter must describe without help.

  > #### Careful {: .warning}
  >
  > Do not call it twice.

  ## Examples

      iex> Probe.double(2)
      4
  """

  @enforce_keys [:id]
  defstruct [:id, count: 0]

  @typedoc "A probe."
  @type t :: %__MODULE__{id: String.t(), count: non_neg_integer()}
  @typedoc "A timeout."
  @type option :: {:timeout, pos_integer()}
  @typedoc "A value the caller must not open."
  @opaque handle(item) :: {:handle, item}
  @typedoc "Shares its name and arity with a function."
  @type result :: :ok | :error

  @doc "Doubles a number."
  @doc since: "0.1.0"
  @spec double(integer()) :: integer()
  @spec double(float()) :: float()
  def double(number), do: number * 2

  @doc "Starts with defaults."
  @spec start(keyword(), [option()]) :: :ok
  def start(arguments \\ [], options \\ []), do: {arguments, options} && :ok

  @doc "Wraps a handle."
  @spec wrap(item) :: handle(item) when item: term()
  def wrap(item), do: {:handle, item}

  @doc "Returns a result."
  @spec result() :: result()
  def result, do: :ok

  @doc "Replaced."
  @deprecated "Use double/1."
  def twice(number), do: double(number)

  @doc "Runs the block unless the value is empty."
  @spec unless_empty(list(), Macro.t()) :: Macro.t()
  defmacro unless_empty(value, do: block) do
    quote do
      if unquote(value) != [], do: unquote(block)
    end
  end

  defdelegate length(list), to: Kernel

  @doc false
  def hidden, do: :ok
end

defmodule Probe.Internal do
  @moduledoc false
  def secret, do: 1
end

defmodule Probe.Behaviour do
  @moduledoc "A behaviour."

  @doc "Opens one connection."
  @callback open(keyword()) :: {:ok, term()}
  @macrocallback build(term()) :: Macro.t()
end

defmodule Probe.Failure do
  @moduledoc "An error."
  defexception [:message, code: 1]
  @type t :: %__MODULE__{message: String.t(), code: integer()}
end
