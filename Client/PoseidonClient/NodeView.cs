using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace PoseidonClient;

/// <summary>
/// A draggable node on the workflow canvas with input/output connectors.
/// </summary>
public class NodeView : Canvas
{
    private readonly MainWindow _mainWindow;
    private readonly NodeViewModel _vm;

    public NodeView(NodeViewModel viewModel, MainWindow mainWindow)
    {
        _vm = viewModel;
        _mainWindow = mainWindow;
        DataContext = viewModel;

        Width = 180;
        Height = 70;

        // Node background
        var background = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x3E, 0x3E, 0x42)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(0x55, 0x55, 0x55)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Width = 180,
            Height = 70
        };

        // Title bar
        var titleBar = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x2D, 0x2D, 0x2D)),
            Height = 24,
            CornerRadius = new CornerRadius(3, 3, 0, 0),
            Width = 180,
            Child = new TextBlock
            {
                Text = viewModel.Name,
                Foreground = Brushes.White,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0)
            }
        };

        // Type badge
        var typeBadge = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x00, 0x7A, 0xCC)),
            Width = 24,
            Height = 16,
            CornerRadius = new CornerRadius(2),
            Child = new TextBlock
            {
                Text = viewModel.Type.Length > 2 ? viewModel.Type[..2].ToUpper() : viewModel.Type,
                Foreground = Brushes.White,
                FontSize = 9,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center
            }
        };

        // Connectors
        var inputConnector = new ConnectorView(this, ConnectorType.Input);
        var outputConnector = new ConnectorView(this, ConnectorType.Output);

        // Script preview
        var scriptText = new TextBlock
        {
            Text = viewModel.Script.Length > 30 ? viewModel.Script[..30] + "…" : viewModel.Script,
            Foreground = Brushes.LightGray,
            FontSize = 9,
            TextWrapping = TextWrapping.Wrap,
            Width = 160,
            Margin = new Thickness(8, 28, 8, 4),
            VerticalAlignment = VerticalAlignment.Top
        };

        Children.Add(background);
        Children.Add(titleBar);
        Children.Add(typeBadge);
        Children.Add(inputConnector);
        Children.Add(outputConnector);
        Children.Add(scriptText);

        // Position connectors
        Canvas.SetLeft(inputConnector, 0);
        Canvas.SetTop(inputConnector, 35);
        Canvas.SetLeft(outputConnector, Width - 10);
        Canvas.SetTop(outputConnector, 35);
        Canvas.SetLeft(typeBadge, Width - 28);
        Canvas.SetTop(typeBadge, 4);

        // Mouse events
        MouseLeftButtonDown += (s, e) =>
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                _mainWindow.NodeMouseDown(this, e);
            }
        };

        MouseMove += (s, e) =>
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                _mainWindow.NodeMouseMove(this, e);
            }
        };

        MouseLeftButtonUp += (s, e) =>
        {
            _mainWindow.NodeMouseUp(this, e);
        };

        // Connector events
        inputConnector.MouseLeftButtonDown += (s, e) =>
        {
            _mainWindow.NodeConnectorMouseDown(this, inputConnector, e);
        };

        outputConnector.MouseLeftButtonDown += (s, e) =>
        {
            _mainWindow.NodeConnectorMouseDown(this, outputConnector, e);
        };
    }

    public Point GetCenterPosition()
    {
        var x = Canvas.GetLeft(this) + Width / 2;
        var y = Canvas.GetTop(this) + Height / 2;
        return new Point(x, y);
    }

    public enum ConnectorType { Input, Output }
}

/// <summary>
/// A small circular connector on a node for drawing edges.
/// </summary>
public class ConnectorView : Canvas
{
    public NodeView ParentNode { get; }
    public NodeView.ConnectorType Type { get; }

    public ConnectorView(NodeView parentNode, NodeView.ConnectorType type)
    {
        ParentNode = parentNode;
        Type = type;

        Width = 10;
        Height = 10;

        var ellipse = new Ellipse
        {
            Width = 10,
            Height = 10,
            Fill = type == NodeView.ConnectorType.Input
                ? new SolidColorBrush(Color.FromRgb(0x6C, 0x6C, 0x6C))
                : new SolidColorBrush(Color.FromRgb(0x00, 0x7A, 0xCC)),
            Stroke = Brushes.White,
            StrokeThickness = 1
        };

        Children.Add(ellipse);
    }

    public Point GetCenterPosition()
    {
        var x = Canvas.GetLeft(ParentNode) + (Type == NodeView.ConnectorType.Input ? 0 : ParentNode.Width);
        var y = Canvas.GetTop(ParentNode) + ParentNode.Height / 2;
        return new Point(x, y);
    }
}
