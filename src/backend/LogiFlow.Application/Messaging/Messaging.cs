using MediatR;

namespace LogiFlow.Application.Messaging;

/// <summary>A mutating use case that returns a result.</summary>
public interface ICommand<TResponse> : IRequest<TResponse>;

/// <summary>A mutating use case with no result.</summary>
public interface ICommand : IRequest;

/// <summary>A read-only use case that returns a result.</summary>
public interface IQuery<TResponse> : IRequest<TResponse>;
