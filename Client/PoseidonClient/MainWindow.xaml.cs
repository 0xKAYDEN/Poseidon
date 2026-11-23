using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using PoseidonClient.Network;

namespace PoseidonClient;

/// <summary>
/// Poseidon desktop client — dark-mode workflow canvas for the Lua-based n8n alternative.
/// Communicates with the Poseidon server over an encrypted WebSocket (X25519 handshake + AES-256-GCM frames).
/// </summary>
public partial class MainWindow : Window
{
    private SecureClientChannel? _channel;
    private CancellationTokenSource? _cts;

    // Canvas state
    private bool _isDraggingCanvas;
    private Point _dragStart;
    private double _canvasOffsetX, _canvasOffsetY;

    // Node interaction state
    private NodeView? _selectedNode;
    private NodeView? _dragSourceNode;
    private bool _isDraggingNode;
    private Point _dragOffset;
    private ConnectorView? _dragConnector;
    private Line? _previewLine;

    // Data model
    private readonly ObservableCollection<NodeViewModel> _nodes = new();
    private readonly ObservableCollection<EdgeViewModel> _edges = new();

    public MainWindow()
    {
        InitializeComponent();

        // Wire up node palette drag source
        NodePalette.SelectionChanged += NodePalette_SelectionChanged;

        Log("Poseidon client started. Connect to the server to begin.");
    }

    // ---------------- connection ----------------

    private async void ConnectToServer()
    {
        try
        {
            _channel = new SecureClientChannel();
            var uri = new Uri("ws://localhost:7071/ws");
            await _channel.ConnectAsync(uri);

            // JWT auth — in a real app this comes from a login dialog
            var token = Environment.GetEnvironmentVariable("POSEIDON_CLIENT_JWT") ?? string.Empty;
            if (!string.IsNullOrEmpty(token))
            {
                await _channel.AuthenticateAsync(token);
            }

            ConnectionText.Text = "Connected (encrypted)";
            ConnectionText.Foreground = Brushes.LightGreen;
            StatusText.Text = "Ready";

            _cts = new CancellationTokenSource();
            _ = Task.Run(async () =>
            {
                await foreach (var json in _channel.ReceiveEventsAsync(_cts.Token))
                {
                    Dispatcher.Invoke(() => Log(json));
                }
            }, _cts.Token);

            Log("Secure channel established (X25519 + AES-256-GCM).");
        }
        catch (Exception ex)
        {
            Log($"Connection failed: {ex.Message}");
            ConnectionText.Text = "Connection failed";
            ConnectionText.Foreground = Brushes.OrangeRed;
        }
    }

    // ---------------- toolbar ----------------

    private void NewWorkflow_Click(object sender, RoutedEventArgs e)
    {
        _nodes.Clear();
        _edges.Clear();
        RebuildCanvas();
        Log("New workflow created.");
    }

    private void OpenWorkflow_Click(object sender, RoutedEventArgs e)
    {
        Log("Open workflow — not implemented in MVP.");
    }

    private async void SaveWorkflow_Click(object sender, RoutedEventArgs e)
    {
        if (_channel is null || !_channel.IsConnected)
        {
            Log("Not connected to server.");
            return;
        }

        var definition = new
        {
            name = "workflow_" + DateTime.UtcNow.ToString("yyyyMMddHHmmss"),
            nodes = _nodes.Select(n => new { id = n.Id, type = n.Type, name = n.Name, x = n.X, y = n.Y, script = n.Script }),
            edges = _edges.Select(e => new { source = e.SourceNodeId, target = e.TargetNodeId, condition = e.Condition })
        };

        var payload = new
        {
            type = "save_workflow",
            definition = definition
        };

        try
        {
            var response = await _channel.SendRequestAsync<JsonElement>(payload, CancellationToken.None);
            Log($"Workflow saved: {response}");
        }
        catch (Exception ex)
        {
            Log($"Save failed: {ex.Message}");
        }
    }

    private async void ExecuteWorkflow_Click(object sender, RoutedEventArgs e)
    {
        if (_channel is null || !_channel.IsConnected)
        {
            Log("Not connected to server.");
            return;
        }

        if (_nodes.Count == 0)
        {
            Log("No nodes to execute.");
            return;
        }

        // Find entry nodes (no incoming edges)
        var entryNodes = _nodes.Where(n => !_edges.Any(e => e.TargetNodeId == n.Id)).ToList();
        if (entryNodes.Count == 0)
        {
            Log("No entry point found (cycle detected?).");
            return;
        }

        var payload = new
        {
            type = "execute_workflow",
            workflow_id = 1UL, // placeholder — in MVP we use a fixed workflow id
            nodes = _nodes.Select(n => new { id = n.Id, type = n.Type, script = n.Script }),
            edges = _edges.Select(e => new { source = e.SourceNodeId, target = e.TargetNodeId, condition = e.Condition }),
            inputs = new Dictionary<string, object>()
        };

        Log($"Executing workflow with {_nodes.Count} nodes...");
        try
        {
            await _channel.SendRequestAsync<JsonElement>(payload, CancellationToken.None);
        }
        catch (Exception ex)
        {
            Log($"Execute failed: {ex.Message}");
        }
    }

    private void StopWorkflow_Click(object sender, RoutedEventArgs e)
    {
        Log("Stop requested — not implemented in MVP.");
        _cts?.Cancel();
    }

    private void AddNode_Click(object sender, RoutedEventArgs e)
    {
        var selected = NodePalette.SelectedItem as ListBoxItem;
        if (selected is null) return;
        AddNodeFromTag(selected.Tag as string ?? "code", new Point(400, 300));
    }

    private void DeleteSelected_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedNode is null) return;
        RemoveNode(_selectedNode);
        _selectedNode = null;
        ScriptEditor.Text = string.Empty;
        PropertiesPanel.Children.Clear();
        RebuildCanvas();
    }

    // ---------------- node palette ----------------

    private string? _paletteDragType;
    private Point _paletteDragStart;

    private void NodePalette_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // Selection changed - not used for drag
    }

    private void PaletteItem_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (sender is ListBoxItem item)
        {
            _paletteDragType = item.Tag as string;
            _paletteDragStart = e.GetPosition(NodePalette);
        }
    }

    private void PaletteItem_MouseMove(object sender, MouseEventArgs e)
    {
        if (_paletteDragType is null) return;
        if (e.LeftButton != MouseButtonState.Pressed) return;

        var pos = e.GetPosition(NodePalette);
        if (Math.Abs(pos.X - _paletteDragStart.X) > 10 || Math.Abs(pos.Y - _paletteDragStart.Y) > 10)
        {
            DragDrop.DoDragDrop(NodePalette, _paletteDragType, DragDropEffects.Copy);
            _paletteDragType = null;
        }
    }

    private void AddNodeFromTag(string type, Point position)
    {
        var id = Guid.NewGuid().ToString("N")[..8];
        var name = type.Replace("_", " ").ToUpperInvariant();
        var script = GetDefaultScript(type);

        var vm = new NodeViewModel(id, type, name, position.X, position.Y, script);
        _nodes.Add(vm);
        var view = new NodeView(vm, this);
        Canvas.SetLeft(view, position.X);
        Canvas.SetTop(view, position.Y);
        WorkflowCanvas.Children.Add(view);
        Log($"Added node: {name} ({type})");
    }

    private static string GetDefaultScript(string type)
    {
        return type switch
        {
            "http_request" => "return {\n  run = function(context)\n    local r = http.get(context.inputs.url or \"https://api.example.com\")\n    return { status = r.status_code, body = r.body }\n  end\n}",
            "mysql_query" => "return {\n  run = function(context)\n    local rows = db.query(context.inputs.sql or \"SELECT 1\")\n    return { rows = rows }\n  end\n}",
            "code" => "return {\n  run = function(context)\n    flow.log(\"running node: \" .. context.node.name)\n    return { result = \"ok\", inputs = context.inputs }\n  end\n}",
            "if" => "return {\n  run = function(context)\n    local ok = context.inputs.ok or false\n    return { branch = ok and \"success\" or \"failure\" }\n  end\n}",
            "wait" => "return {\n  run = function(context)\n    flow.sleep(context.inputs.ms or 1000)\n    return { waited = true }\n  end\n}",
            "ai" => "return {\n  run = function(context)\n    local r = ai.chat({ model = \"gpt-4o-mini\", messages = {{ role = \"user\", content = context.inputs.text or \"\" }} })\n    return { reply = r.content }\n  end\n}",
            "mail" => "return {\n  run = function(context)\n    mail.send({ to = context.inputs.to, subject = \"Poseidon\", body = context.inputs.message or \"\" })\n    return { sent = true }\n  end\n}",
            _ => "return {\n  run = function(context)\n    return { ok = true }\n  end\n}"
        };
    }

    // ---------------- canvas interaction ----------------

    private void Canvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        var pos = e.GetPosition(WorkflowCanvas);
        _dragStart = pos;
        _isDraggingCanvas = true;
        WorkflowCanvas.CaptureMouse();
    }

    private void Canvas_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        _isDraggingCanvas = false;
        WorkflowCanvas.ReleaseMouseCapture();

        // Complete edge creation if we were dragging a connector
        if (_dragConnector is not null && _previewLine is not null)
        {
            // Check if we dropped on another node's connector
            var hit = VisualTreeHelper.HitTest(WorkflowCanvas, e.GetPosition(WorkflowCanvas));
            if (hit?.VisualHit is ConnectorView targetConnector && targetConnector.ParentNode != _dragConnector.ParentNode)
            {
                CreateEdge(_dragConnector, targetConnector);
            }
            WorkflowCanvas.Children.Remove(_previewLine);
            _previewLine = null;
            _dragConnector = null;
        }
    }

    private void Canvas_MouseMove(object sender, MouseEventArgs e)
    {
        if (_isDraggingCanvas)
        {
            var pos = e.GetPosition(WorkflowCanvas);
            var delta = pos - _dragStart;
            _canvasOffsetX += delta.X;
            _canvasOffsetY += delta.Y;
            _dragStart = pos;
            WorkflowCanvas.RenderTransform = new TranslateTransform(_canvasOffsetX, _canvasOffsetY);
            return;
        }

        // Preview line for edge creation
        if (_dragConnector is not null && e.LeftButton == MouseButtonState.Pressed && _previewLine is not null)
        {
            var pos = e.GetPosition(WorkflowCanvas);
            _previewLine.X2 = pos.X;
            _previewLine.Y2 = pos.Y;
        }
    }

    private void Canvas_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetDataPresent("NodeType"))
        {
            var type = e.Data.GetData("NodeType") as string;
            var pos = e.GetPosition(WorkflowCanvas);
            // Adjust for scroll offset
            pos.X -= _canvasOffsetX;
            pos.Y -= _canvasOffsetY;
            AddNodeFromTag(type ?? "code", pos);
        }
    }

    // ---------------- node view integration ----------------

    internal void NodeConnectorMouseDown(NodeView node, ConnectorView connector, MouseButtonEventArgs e)
    {
        _dragConnector = connector;
        _previewLine = new Line
        {
            X1 = connector.GetCenterPosition().X,
            Y1 = connector.GetCenterPosition().Y,
            X2 = connector.GetCenterPosition().X,
            Y2 = connector.GetCenterPosition().Y,
            Stroke = Brushes.LightGray,
            StrokeThickness = 2,
            StrokeDashArray = new DoubleCollection { 4, 2 }
        };
        WorkflowCanvas.Children.Add(_previewLine);
        Panel.SetZIndex(_previewLine, 0);
        e.Handled = true;
    }

    internal void NodeMouseDown(NodeView node, MouseButtonEventArgs e)
    {
        _selectedNode = node;
        _dragSourceNode = node;
        _isDraggingNode = true;
        _dragOffset = e.GetPosition(node);
        node.CaptureMouse();
        e.Handled = true;

        UpdatePropertiesPanel(node);
    }

    internal void NodeMouseMove(NodeView node, MouseEventArgs e)
    {
        // Connector drag: update preview line
        if (_dragConnector is not null && _previewLine is not null)
        {
            var connectorPos = e.GetPosition(WorkflowCanvas);
            _previewLine.X2 = connectorPos.X;
            _previewLine.Y2 = connectorPos.Y;
            e.Handled = true;
            return;
        }

        if (!_isDraggingNode || _dragSourceNode != node) return;

        var nodePos = e.GetPosition(WorkflowCanvas);
        Canvas.SetLeft(node, nodePos.X - _dragOffset.X);
        Canvas.SetTop(node, nodePos.Y - _dragOffset.Y);

        var vm = (NodeViewModel)node.DataContext;
        vm.X = nodePos.X - _dragOffset.X;
        vm.Y = nodePos.Y - _dragOffset.Y;

        UpdateEdgesForNode(node);
        e.Handled = true;
    }

    internal void NodeMouseUp(NodeView node, MouseButtonEventArgs e)
    {
        // Complete edge creation if we were dragging a connector
        if (_dragConnector is not null && _previewLine is not null)
        {
            var pos = e.GetPosition(WorkflowCanvas);
            var hit = VisualTreeHelper.HitTest(WorkflowCanvas, pos);
            if (hit?.VisualHit is ConnectorView targetConnector &&
                targetConnector.ParentNode != _dragConnector.ParentNode)
            {
                CreateEdge(_dragConnector, targetConnector);
            }
            WorkflowCanvas.Children.Remove(_previewLine);
            _previewLine = null;
            _dragConnector = null;
            e.Handled = true;
            return;
        }

        _isDraggingNode = false;
        _dragSourceNode = null;
        node.ReleaseMouseCapture();
        e.Handled = true;
    }

    private void CreateEdge(ConnectorView source, ConnectorView target)
    {
        var sourceVm = (NodeViewModel)source.ParentNode.DataContext;
        var targetVm = (NodeViewModel)target.ParentNode.DataContext;

        var edge = new EdgeViewModel(sourceVm.Id, targetVm.Id, "always");
        _edges.Add(edge);
        RebuildCanvas();
        Log($"Edge: {sourceVm.Name} -> {targetVm.Name}");
    }

    private void UpdateEdgesForNode(NodeView node)
    {
        var vm = (NodeViewModel)node.DataContext;
        var canvas = WorkflowCanvas;

        // Remove old edges connected to this node and redraw
        var edgesToUpdate = _edges.Where(e => e.SourceNodeId == vm.Id || e.TargetNodeId == vm.Id).ToList();
        foreach (var edge in edgesToUpdate)
        {
            // Find the visual line and update it
            foreach (var child in canvas.Children.OfType<Line>())
            {
                if (child.Tag is EdgeViewModel evm && evm.Id == edge.Id)
                {
                    var sourceNode = FindNodeView(evm.SourceNodeId);
                    var targetNode = FindNodeView(evm.TargetNodeId);
                    if (sourceNode is not null && targetNode is not null)
                    {
                        var sPos = sourceNode.GetCenterPosition();
                        var tPos = targetNode.GetCenterPosition();
                        child.X1 = sPos.X;
                        child.Y1 = sPos.Y;
                        child.X2 = tPos.X;
                        child.Y2 = tPos.Y;
                    }
                }
            }
        }
    }

    private NodeView? FindNodeView(string nodeId)
    {
        foreach (var child in WorkflowCanvas.Children.OfType<NodeView>())
        {
            if (((NodeViewModel)child.DataContext).Id == nodeId)
                return child;
        }
        return null;
    }

    private void RemoveNode(NodeView node)
    {
        var vm = (NodeViewModel)node.DataContext;
        var edgesToRemove = _edges.Where(e => e.SourceNodeId == vm.Id || e.TargetNodeId == vm.Id).ToList();
        foreach (var edge in edgesToRemove) _edges.Remove(edge);
        _nodes.Remove(vm);
        WorkflowCanvas.Children.Remove(node);
    }

    private void RebuildCanvas()
    {
        // Clear all visual elements except nodes
        var lines = WorkflowCanvas.Children.OfType<Line>().ToList();
        foreach (var line in lines) WorkflowCanvas.Children.Remove(line);

        // Draw edges
        foreach (var edge in _edges)
        {
            var sourceNode = FindNodeView(edge.SourceNodeId);
            var targetNode = FindNodeView(edge.TargetNodeId);
            if (sourceNode is null || targetNode is null) continue;

            var sPos = sourceNode.GetCenterPosition();
            var tPos = targetNode.GetCenterPosition();

            var line = new Line
            {
                X1 = sPos.X,
                Y1 = sPos.Y,
                X2 = tPos.X,
                Y2 = tPos.Y,
                Stroke = new SolidColorBrush(Color.FromRgb(0x55, 0x55, 0x55)),
                StrokeThickness = 2,
                Tag = edge
            };
            WorkflowCanvas.Children.Add(line);
            Panel.SetZIndex(line, 0);
        }
    }

    private void UpdatePropertiesPanel(NodeView node)
    {
        PropertiesPanel.Children.Clear();
        var vm = (NodeViewModel)node.DataContext;

        AddPropertyRow("ID", vm.Id, isReadOnly: true);
        AddPropertyRow("Type", vm.Type, isReadOnly: true);
        AddPropertyRow("Name", vm.Name);
        AddPropertyRow("X", vm.X.ToString("F0"));
        AddPropertyRow("Y", vm.Y.ToString("F0"));
    }

    private void AddPropertyRow(string label, string value, bool isReadOnly = false)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 3, 0, 3) };
        panel.Children.Add(new TextBlock { Text = label + ":", Width = 80, Foreground = Brushes.Silver, FontSize = 11 });
        var box = new TextBox { Text = value, Width = 140, IsReadOnly = isReadOnly };
        box.TextChanged += (s, e) =>
        {
            var vm = (NodeViewModel)_selectedNode!.DataContext;
            if (label == "Name") vm.Name = box.Text;
            else if (label == "X") { if (double.TryParse(box.Text, out var x)) vm.X = x; }
            else if (label == "Y") { if (double.TryParse(box.Text, out var y)) vm.Y = y; }
        };
        panel.Children.Add(box);
        PropertiesPanel.Children.Add(panel);
    }

    private void Log(string message)
    {
        var entry = $"[{DateTime.Now:HH:mm:ss}] {message}";
        Dispatcher.Invoke(() =>
        {
            ExecutionLog.Items.Insert(0, entry);
            if (ExecutionLog.Items.Count > 200) ExecutionLog.Items.RemoveAt(200);
        });
    }

    // ---------------- lifecycle ----------------

    protected override async void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        ConnectToServer();
    }

    protected override void OnClosed(EventArgs e)
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _channel?.Dispose();
        base.OnClosed(e);
    }
}


