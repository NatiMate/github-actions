const core = require('@actions/core');
const github = require('@actions/github');
const { Octokit } = require('@octokit/rest');
const fetch = require('./node_modules/node-fetch');

try {
  const apiKey = process.env['TRELLO_API_KEY'];
  const apiToken = process.env['TRELLO_API_TOKEN'];
  const action = core.getInput('trello-action');

  switch (action) {
    case 'create_card_when_issue_opened':
      handleIssueOpened(apiKey, apiToken);
      break;
    case 'move_card_when_pull_request_opened':
      moveCardWhenPullRequestOpen(apiKey, apiToken);
      break;
    case 'move_card_when_issue_closed':
      moveCardWhenIssueClose(apiKey, apiToken);
      break;
  }
} catch (error) {
  core.setFailed(error.message);
}

function handleIssueOpened(apiKey, apiToken) {
  const issue = github.context.payload.issue
  if (typeof issue == 'undefined') {
    core.setFailed('Action create_card_when_issue_opened may only be called on issues.');
    return;
  }

  const match = issue.title.match(new RegExp(/fetch (?<cardId>[a-z0-9]{24})/, "i"));
  if (match != null) {
    fetchCardWhenIssueOpen(apiKey, apiToken, issue, match[1])
  } else {
    createCardWhenIssueOpen(apiKey, apiToken, issue)
  }
}

function fetchCardWhenIssueOpen(apiKey, apiToken, issue, cardId) {
  getCard(apiKey, apiToken, cardId).then(response => {
    const trelloLabels = []
    response['labels'].forEach(trelloLabel => {
      trelloLabels.push(trelloLabel.name)
    });

    const patchData = {
      title: response['name'],
      labels: trelloLabels,
      body: response['desc'] + `\n\nThis issue was automatically linked to Trello card [[#${issue.number}] ${response['name']}](${response['shortUrl']}). Closing this issue will move the Trello card to the archive.\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY ${response['id']}-->`,
    }

    patchIssue(
      github.context.repo.owner,
      github.context.repo.repo,
      issue.number,
      patchData
    ).then(_ => {
      console.dir(`Successfully updated issue ${issue.number} from trello card ${cardId}`)
      const cardParams = {
        key: apiKey,
        token: apiToken,
        url: issue.html_url,
        name: `[#${issue.number}] ${response['name']}`
      }

      updateCard(cardId, cardParams).then(_ => {
        addUrlSourceToCard(cardId, cardParams).then(_ => {
          console.dir(`Successfully updated card ${cardId}`)
        }).catch((error) => core.warning(`Could not attach issue to trello card ${cardId}. ${error}`));
      }).catch((error) => core.warning(`Could not update name of trello card ${cardId}. ${error}`));
    }).catch((error) => core.setFailed(`Could not patch issue from card ${cardId}. ${error}`))
  }).catch((error) => core.setFailed(`Could not fetch trello card ${cardId}. ${error}`));
}

function createCardWhenIssueOpen(apiKey, apiToken, issue) {
  const boardId = process.env['TRELLO_BOARD_ID'];
  const repositoryLabels = core.getInput('repository-labels').split(',');
  const issueLabelNames = issue.labels.map(label => label.name).concat(repositoryLabels);

  getLabelsOfBoard(apiKey, apiToken, boardId).then(response => {
    const trelloLabels = response;
    const trelloLabelIds = [];
    issueLabelNames.forEach(issueLabelName => {
      trelloLabels.forEach(trelloLabel => {
        if (trelloLabel.name == issueLabelName) {
          trelloLabelIds.push(trelloLabel.id);
        }
      });
    });

    var cardBody = issue.body;
    const issueNumber = issue.number;
    const cardParams = {
      key: apiKey,
      token: apiToken,
      idList: process.env['TRELLO_TO_DO_LIST_ID'],
      desc: cardBody,
      urlSource: issue.html_url,
      idLabels: trelloLabelIds.join(),
      name: `[#${issueNumber}] ${issue.title}`
    }

    createCard(cardParams).then(response => {
      console.dir(`Successfully created trello card.`);
      const patchData = {
        body: issue.body + `\n\nThis issue was automatically linked to Trello card [${response['name']}](${response['shortUrl']}). Closing this issue will move the Trello card to the archive.\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY ${response['id']}-->`,
      }

      patchIssue(
        github.context.repo.owner,
        github.context.repo.repo,
        issueNumber,
        patchData
      ).catch((error) => core.setFailed(`Created trello card but could not patch issue. ${error}`))
    }).catch((error) => core.setFailed(`Could not create trello card. ${error}`));
  }).catch((error) => core.setFailed(`Could not fetch trello board labels. ${error}`));
}

function moveCardWhenPullRequestOpen(apiKey, apiToken) {
  const pullRequest = github.context.payload.pull_request
  if (typeof pullRequest == 'undefined') {
    core.setFailed('Action move_card_when_pull_request_opened may only be called on pull requests.');
    return;
  }
  if (typeof pullRequest.body !== 'string') {
    return;
  }

  const keywordRegex = new RegExp(/(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved) ((?<owner>[^ ]+?)\/(?<repo>[^ ]+?))?#(?<issueNumber>[0-9]+)/, "i")
  const matches = [...pullRequest.body.matchAll(keywordRegex)]
  const octokit = new Octokit({auth: core.getInput('repo-token')})

  matches.forEach(element => {
    var owner = element[2];
    var repo = element[3];
    const issue_number = Number(element[4]);
    if (typeof owner === "undefined" || owner === null) { 
      owner = github.context.repo.owner;
    }
    if (typeof repo === "undefined" || repo === null) { 
      repo = github.context.repo.repo;
    }

    octokit.rest.issues.get({
      owner: owner,
      repo: repo,
      issue_number: issue_number
    }).then(issue => {
      const body = issue.data.body;
      if (typeof body !== 'string') {
        core.warning('Linked an issue which does not have a body and trello card. Skipping')
        return;
      }
        
      const cardId = body.substring(body.length-27, body.length-3);
      const cardParams = {
        key: apiKey,
        token: apiToken,
        idList: process.env['TRELLO_REVIEW_LIST_ID'],
      }

      updateCard(cardId, cardParams).then(response => {
        const cardAttachmentParams = {
          key: apiKey,
          token: apiToken,
          url: pullRequest.html_url
        }

        addUrlSourceToCard(cardId, cardAttachmentParams).then(response => {
          console.dir(`Successfully updated card ${cardId}`)
        }).catch((error) => core.warning(`Could not attach PR to trello card. ${error}`));
      }).catch((error) => core.warning(`Could not update trello card. ${error}`));
    }).catch(error => core.setFailed(`Could not get issue ${owner}/${repo}#${issue_number}. ${error}`));
  })
}

function moveCardWhenIssueClose(apiKey, apiToken) {
  const issue = github.context.payload.issue
  if (typeof issue == 'undefined') {
    core.setFailed('Action move_card_when_issue_closed may only be called on issues.');
    return;
  }

  if (typeof issue.body !== 'string') {
    core.setFailed('Action move_card_when_issue_closed can only succeed on issues with a body.');
    return;
  }
  
  const description = issue.body;
  const cardId = description.substring(description.length-27, description.length-3)
  const cardParams = {
    key: apiKey,
    token: apiToken,
    idList: process.env['TRELLO_DONE_LIST_ID'],
  }

  updateCard(cardId, cardParams).then(response => {
    console.dir(`Successfully updated card ${cardId}`)
    const patchData = {
      body: description.replace(/\n\nThis issue was automatically linked to Trello card \[.+?\)\. Closing this issue will move the Trello card to the archive\.\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY .+?-->/, ''),
    }
    
    patchIssue(
      github.context.repo.owner,
      github.context.repo.repo,
      issue.number,
      patchData
    ).catch((error) => core.setFailed(`Moved trello card but could not patch issue. ${error}`))
  }).catch((error) => core.setFailed(`Could not update trello card. ${error}`));
}

async function getLabelsOfBoard(apiKey, apiToken, boardId) {
  const options = {
    method: 'GET',
    headers: {
      "Content-Type": "application/json"
    },
  }
  const response = await fetch(`https://api.trello.com/1/boards/${boardId}/labels?key=${apiKey}&token=${apiToken}`, options);
  return await response.json();
}

async function getCard(apiKey, apiToken, cardId) {
  const options = {
    method: 'GET',
    headers: {
      "Content-Type": "application/json"
    },
  }
  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${apiKey}&token=${apiToken}`, options);
  return await response.json();
}

async function createCard(params) {
  const options = {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
    },
  }

  var queryParameters = ""
  for (const [key, value] of Object.entries(params)) {
      if (queryParameters !== "") {
          queryParameters += '&'
      }
      queryParameters += `${key}=${encodeURIComponent(value)}`
  }

  const response = await fetch(`https://api.trello.com/1/cards?${queryParameters}`, options);
  return await response.json();
}

async function updateCard(cardId, params) {
  const options = {
    method: 'PUT',
    headers: {
      "Content-Type": "application/json"
    },
  }

  var queryParameters = ""
  for (const [key, value] of Object.entries(params)) {
      if (queryParameters !== "") {
          queryParameters += '&'
      }
      queryParameters += `${key}=${encodeURIComponent(value)}`
  }

  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?${queryParameters}`, options)
  return await response.json();
}

async function addUrlSourceToCard(cardId, params) {
  const options = {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
    },
  }

  var queryParameters = ""
  for (const [key, value] of Object.entries(params)) {
      if (queryParameters !== "") {
          queryParameters += '&'
      }
      queryParameters += `${key}=${value}`
  }

  const response = await fetch(`https://api.trello.com/1/cards/${cardId}/attachments?${queryParameters}`, options)
  return await response.json()
}

async function patchIssue(owner, repo, issue_number, params) {
  console.dir(`Calling PATCH for /repos/${owner}/${repo}/issues/${issue_number}`);
  const octokit = new Octokit({auth: core.getInput('repo-token')})
  await octokit.request(`PATCH /repos/${owner}/${repo}/issues/${issue_number}`, Object.assign({}, {
    owner: owner,
    repo: repo,
    issue_number: issue_number,
  }, params));
}
