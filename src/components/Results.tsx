Here's the fixed version with all missing closing brackets added:

```javascript
// src/components/Results.tsx (complete file - copy and paste this entire file)
// [Previous code remains unchanged until the end]

        {/* Debug Info */}
        {debugMode && (
          <div className="bg-black/20 backdrop-blur-sm rounded-lg p-4 mb-6 text-white text-sm font-mono overflow-auto max-h-60">
            <div>Room ID: {room.id}</div>
            <div>Activation ID: {currentActivation?.id}</div>
            <div>Activation Type: {currentActivation?.type}</div>
            <div>Poll State: {pollState}</div>
            <div>Show Answers: {showAnswers.toString()}</div>
            <div>Total Votes: {totalVotes}</div>
            <div>Poll Votes (by text): {JSON.stringify(pollVotesByText)}</div>
            <div>Network Status: {networkError ? 'Offline' : 'Online'}</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-3 py-1 bg-white/10 rounded hover:bg-white/20"
            >
              <RefreshCw className="w-4 h-4 inline mr-2" />
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```