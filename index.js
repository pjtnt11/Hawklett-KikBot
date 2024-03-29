	'use strict'

	var util     = require('util')
	var fs       = require('fs')
	var http     = require('http')
	var Bot      = require('@kikinteractive/kik')
	var firebase = require('firebase')
	var schedule = require('node-schedule')
	var moment   = require('moment');

	var contents = fs.readFileSync("BHSAcademyBot.json");
	var botData = JSON.parse(contents);

	var bot = new Bot(botData)

	bot.updateBotConfiguration()

	firebase.initializeApp(
	{
		databaseURL: "https://bhs-academy-kik-bot.firebaseio.com/",
		serviceAccount: "/home/ec2-user/BHSAcademyBot/serviceAccountCredentials.json"
	})

	var database = firebase.database()
	var homeworkRef = database.ref("/homework")
	var usersRef = database.ref("/users")
	var announcementsRef = database.ref("/announcements")
	var votingRef = database.ref("/voting")
	var feedbackRef = database.ref("/feedback")
	var peerRef = database.ref("/peer_review")

	var dailyHomeworkSchedule = schedule.scheduleJob('30 15 * * *', function ()
	{
		var users = []

		usersRef.orderByChild("subscribed").equalTo(true).once("value", function (snapshot)
		{
			snapshot.forEach(function(childSnapshot)
			{
				var decodedMessageFromUsername = snapshot.key
				decodedMessageFromUsername = decodedMessageFromUsername.replace(/%2E/g, "\.")

				users.push(decodedMessageFromUsername)
			})

			getHomeworkString(function (homework)
			{
				homeworkRef.child("notifications_enabled").once("value", function (snapshot)
				{
					if (snapshot.val() == true)
					{
						let homeworkString = Bot.Message.text(homework).addResponseKeyboard(["Dismiss"])
						bot.broadcast(homeworkString, users)
						console.log("Daily homework notification sent to " + users.length + "users")
					}
				})
			})
		})
	})

	var archiveHomeworkSchedule = schedule.scheduleJob('0 2 * * *', function ()
	{
		homeworkRef.child("auto_archive_enabled").once("value", function (snapshot)
		{
			if (snapshot.val() == true)
			{
				var data = {}
				homeworkRef.child("items").once("value", function(snapshot)
				{
					data["negative_timestamp"] = ((new Date() / 1000) * -1) + 86400

					let archiveRef = homeworkRef.child("past").push()
					archiveRef.set(snapshot.val())
					archiveRef.update(data)
				})
				homeworkRef.child("items").set(null)
				console.log("Homework has been archived")
			}
		})
	})

	function createUser(message, callback)
	{
		var data = {}

		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		data[encodedMessageFromUsername] = {
			context: "home",
			is_admin: false,
			subscribed: true
		}

		usersRef.update(data, function (error)
		{
			if (typeof callback === 'function')
			{
				callback(error)
			}
		})
	}

	function updateContext(message, user, context)
	{
		var data = {}
		data["context"] = context
		usersRef.child(user).update(data)

		getContextMessage(message, context, function (contextMessage)
		{
			if (contextMessage != null)
			{
				bot.send(contextMessage, message.from)
			}
		})
	}

	function getClasses(callback)
	{
		var returnValue = []
		homeworkRef.child("classes").once("value", function(snapshot)
		{
			snapshot.forEach(function(childSnapshot)
			{
				if (childSnapshot.val() == true)
				{
					returnValue.push(childSnapshot.key)
				}
			})
			returnValue.push("Cancel")
			callback(returnValue)
		})
	}

	function resendContextMessage(message, context)
	{
		getContextMessage(message, context, function (contextMessage)
		{
			bot.send(contextMessage, message.from)
		})
	}

	function getContextMessage(message, context, callback)
	{
		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		switch (context)
		{
			case "home":
				let homeContextMessage = Bot.Message.text("How can I help you?")

				let userSuggestedResponses = ["📝 Homework", "📢 Announcements", "🗳 Voting", "🗂 More"]
				let adminSuggestedResponses = ["📝 Homework", "📢 Announcements", "🗳 Voting", "🗂 More", "🔒 Admin Actions"]

				if (message.mention != "bhsacademybot")
				{
					adminCheck(message, function (isAdmin)
					{
						if (isAdmin)
						{
							callback(homeContextMessage.addResponseKeyboard(adminSuggestedResponses))
						}
						else
						{
							callback(homeContextMessage.addResponseKeyboard(userSuggestedResponses))
						}
					})
				}
				else
				{
					callback(null)
				}
				break

			case "settings":
				let settingsString = Bot.Message.text("Which setting would you like to change?")

				userRef.child("subscribed").once("value", function (snapshot)
				{
					if (snapshot.val() === true)
					{
						callback(settingsString.addResponseKeyboard(["Unsubscribe", "Cancel"]), message.from)
					}
					else
					{
						callback(settingsString.addResponseKeyboard(["Subscribe", "Cancel"]), message.from)
					}
				})
				break

			case "admin_actions":
				let adminActionsString = Bot.Message.text("What would you like to do?")

				adminCheck(message, function (is_admin)
				{
					callback(adminActionsString.addResponseKeyboard(["Homework", "Voting", "Make an announcement", "🏠 Back to home"]), message.from)
				})
				break

			case "add_homework_item_classes":
				getClasses(function(classes)
				{
					var homeworkClasses = []
					classes.forEach(function(homeworkClass)
					{
						homeworkClasses.push(homeworkClass)
					})

					let addHomeworkItemString = Bot.Message.text("What class are you adding homework for?").addResponseKeyboard(homeworkClasses)

					callback(addHomeworkItemString)
				})
				break

			case "add_homework_item_body":
			var addHomeworkItemBodyString = Bot.Message.text("What is the homework in that class?").addResponseKeyboard(["Cancel"], true)
			var currentHomework = "Here is the current homework in "
			var homeworkIsInPendingClass = false
				homeworkRef.child("pending_items").child(encodedMessageFromUsername).once("value", function(snapshot)
				{
					let pendingClass = snapshot.val()
					currentHomework = currentHomework + pendingClass + ":\n"
					homeworkRef.child("items").child(pendingClass).once("value", function(snapshot)
					{
						if (snapshot.exists())
						{
							homeworkIsInPendingClass = true
							addHomeworkItemBodyString = Bot.Message.text("What is the homework in " + pendingClass + " that you would like to add?").addResponseKeyboard(["Cancel"], true)

							snapshot.forEach(function(childSnapshot)
							{
								currentHomework = currentHomework + childSnapshot.val() + "\n"
							})

							var responseItems = []

							if (homeworkIsInPendingClass)
							{
								let currentHomeworkMessage = Bot.Message.text(currentHomework)
								responseItems.push(currentHomeworkMessage)
							}

							responseItems.push(addHomeworkItemBodyString)
							callback(responseItems)
						}
						else
						{
							callback(addHomeworkItemBodyString)
						}
					})
				})
				break

			case "remove_homework_item":
			var homeworkRemovableItems = []
			var removeHomeworkItemString = Bot.Message.text("What item would you like to remove")

			homeworkRef.child("pending_removal").child(encodedMessageFromUsername).once("value", function(snapshot)
			{
				homeworkRef.child("items").child(snapshot.val()).once("value", function(snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						homeworkRemovableItems.push(childSnapshot.val())
					})

					homeworkRemovableItems.push("Cancel")
					removeHomeworkItemString.addResponseKeyboard(homeworkRemovableItems)
					callback(removeHomeworkItemString)
				})
			})
			break

			case "remove_homework_item_class":
				var homeworkRemovableClasses = []
				var removeHomeworkItemClassString = Bot.Message.text("Which class would you like to remove homework from?")

				homeworkRef.child("items").once("value", function (snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						homeworkRemovableClasses.push(childSnapshot.key)
					})

					homeworkRemovableClasses.push("Cancel")
					removeHomeworkItemClassString.addResponseKeyboard(homeworkRemovableClasses)
					callback(removeHomeworkItemClassString)
				})
				break

			case "confirm_add_homework_item":
				let addHomeworkItemConfirmationString = Bot.Message.text("There is already homework registered for that class. Are you sure you want to overwrite it?").addResponseKeyboard(["Yes", "No"])
				callback(addHomeworkItemConfirmationString)
				break

			case "make_an_announcement":
				let makeAnAnnouncementString = Bot.Message.text("What is the title of the announcement that you would like to make?").addResponseKeyboard(["Cancel"], true)

				callback(makeAnAnnouncementString)
				break

			case "add_announcement_body":
				let addAnnouncementBodyString = Bot.Message.text("What is the body of your announcement?").addResponseKeyboard(["Cancel"], true)

				callback(addAnnouncementBodyString)
				break

			case "ask_announcement_image":
				let askAnnouncementImageString = Bot.Message.text("Would you like to add an image to your announcement?").addResponseKeyboard(["Yes", "No"])

				callback(askAnnouncementImageString)
				break

			case "ask_change_from":
				let askChangeFromString = Bot.Message.text("Would you like to change who the announcement is from (instead of yourself)?").addResponseKeyboard([Bot.Response.friendPicker("Select a person", 1, 1), "No"])

				callback(askChangeFromString)
				break

			case "confirm_make_announcement":
				let makeAnnouncementConfirmationString = Bot.Message.text("Are you sure that you want to create this announcement and send a message to eveyone on the subscribed list?").addResponseKeyboard(["Yes", "No"])

				callback(makeAnnouncementConfirmationString)
				break

			case "add_announcement_image":
				let addAnnouncementImageString = Bot.Message.text("Please send me the image you would like to attach to this announcement").addResponseKeyboard(["Cancel"], true)

				callback(addAnnouncementImageString)
				break

			case "homework_actions":
				var homeworkActionsList = ["Show homework", "Add homework item", "Remove homework item", "Manually clear homework", "Add homework class", "Remove homework class"]

				homeworkRef.child("auto_clear_enabled").once("value", function (snapshot)
				{
					if (snapshot.val() == true)
					{
						homeworkActionsList.push("Disable homework auto clear")
					}
					else
					{
						homeworkActionsList.push("Enable homework auto clear")
					}

					homeworkRef.child("notifications_enabled").once("value", function (snapshot)
					{
						if (snapshot.val() == true)
						{
							homeworkActionsList.push("Disable homework notifications")
						}
						else
						{
							homeworkActionsList.push("Enable homework notifications")
						}

						homeworkActionsList.push("🔙 To Admin Actions")
						let homeworkActionsString = Bot.Message.text("What would you like to do concerning homework?").addResponseKeyboard(homeworkActionsList)

						callback(homeworkActionsString)
					})
				})
				break

			case "clear_homework":
				let clearHomeworkString = Bot.Message.text("Are you sure that you want to clear ALL of the currently registered homework?").addResponseKeyboard(["Yes", "No"])

				callback(clearHomeworkString)
				break

			case "enable_homework_auto_clear":
				let EnableHomeworkAutoClear = Bot.Message.text("Are you sure that you want to enable homework auto clear? (this happens everyday at 2:00AM)").addResponseKeyboard(["Yes", "No"])

				callback(EnableHomeworkAutoClear)
				break

			case "disable_homework_auto_clear":
				let DisableHomeworkAutoClear = Bot.Message.text("Are you sure that you want to disable homework auto clear?").addResponseKeyboard(["Yes", "No"])

				callback(DisableHomeworkAutoClear)
				break

			case "enable_homework_notifications":
				let EnableHomeworkNotifications = Bot.Message.text("Are you sure that you want enable homework notifications for everyone? (this happens everyday at 3:30PM)").addResponseKeyboard(["Yes", "No"])

				callback(EnableHomeworkNotifications)
				break

			case "disable_homework_notifications":
				let DisableHomeworkNotifications = Bot.Message.text("Are you sure that you want to disable homework notifications?").addResponseKeyboard(["Yes", "No"])

				callback(DisableHomeworkNotifications)
				break

			case "announcements":
				let announcements = []

				let startTime = ((new Date() / 1000) - 604800) * -1
				announcementsRef.child("items").orderByChild("negative_timestamp").endAt(startTime).limitToFirst(19).once("value", function (snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						announcements.push(childSnapshot.val().title)
					})

					announcements.push("Back")
					let announcementsString = Bot.Message.text("Here are the latest announcements").addResponseKeyboard(announcements)
					callback(announcementsString)
				})
				break

			case "voting_actions":
				let VotingActionsString = Bot.Message.text("What would you like to do concerning voting?").addResponseKeyboard(["Create a poll", "End a poll", "🔙 To Admin Actions"])

				callback(VotingActionsString)
				break

			case "create_a_poll":
				let createAPollString = Bot.Message.text("Send me all the votable items that you would lke to add to this poll in individual texts and end me \"Done\" when you have finished").addResponseKeyboard(["Cancel"], true)

				callback(createAPollString)
				break

			case "add_poll_title":
				let addPollTitleString = Bot.Message.text("What is the title of this poll?").addResponseKeyboard(["Cancel"], true)

				callback(addPollTitleString)
				break

			case "ask_make_poll_announcement":
				let askMakePollAnnouncement = Bot.Message.text("Do you want to send all of the subscribers a notification? (NOTE: ONLY DO THIS IF THE POLL IS IMPORTANT)").addResponseKeyboard(["Yes", "No"])

				callback(askMakePollAnnouncement)
				break

			case "confirm_create_poll":
				let ConfirmCreatePollString = Bot.Message.text("Are you sure you want to create this poll?").addResponseKeyboard(["Yes", "No"])

				callback(ConfirmCreatePollString)
				break

			case "voting":
				var pollTitles = []
				votingRef.child("polls").child("active").limitToLast(19).orderByChild("negative_timestamp").once("value", function (snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						pollTitles.push(childSnapshot.val().title)
					})

					pollTitles.push("Back")
					let votingString = Bot.Message.text("Which poll would you like to view?").addResponseKeyboard(pollTitles)

					callback(votingString)
				})
				break

			case "end_a_poll":
				var pollTitles = []
				votingRef.child("polls").child("active").once("value", function (snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						pollTitles.push(childSnapshot.val().title)
					})

					pollTitles.push("🔙 To Voting Actions")
					let endVotingString = Bot.Message.text("Here are the current active polls. Click one of them to stop taking responses").addResponseKeyboard(pollTitles)

					callback(endVotingString)
				})
				break

			case "view_poll_results":
				votingRef.child("polls").child("active").once("value", function (snapshot)
				{
					let activePolls = []
					snapshot.forEach(function(childSnapshot)
					{
						activePolls.push(childSnapshot.val().title)
					})

					activePolls.push("🔙 To Voting Options")
					let viewActivePollsString = Bot.Message.text("Which poll would you like to view the results for?").addResponseKeyboard(activePolls)

					callback(viewActivePollsString)
				})
				break

			case "vote":
				var votingItems = []
				var pollRef = ""

				var encodedMessageFromUsername = message.from
				encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

				votingRef.child("polls").child("active").once("value", function(snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						if(childSnapshot.child("voters").child(encodedMessageFromUsername).val() == "pending")
						{
							pollRef = childSnapshot.key
						}
					})

					snapshot.child(pollRef).child("items").forEach(function(childSnapshot)
					{
						var decodedItemName = childSnapshot.key
						decodedItemName = decodedItemName.replace(/%2E/g, "\.")
						votingItems.push(decodedItemName)
					})

					votingItems.push("Cancel")
					let votingItemsString = Bot.Message.text("Choose which item you would like to vote for (Note: you can not change this)").addResponseKeyboard(votingItems)

					callback(votingItemsString)
				})
				break

			case "feedback":
				let feedbackActionsString = Bot.Message.text("Would you like to submit a suggestion or a complaint?").addResponseKeyboard(["Suggestion", "Complaint", "🏠 Back to Home"])

				callback(feedbackActionsString)
				break

			case "suggestion":
				let SuggestActionsString = Bot.Message.text("What is your suggestion?").addResponseKeyboard(["Cancel"], true)

				callback(SuggestActionsString)
				break

			case "complaint":
				let ComplaintActionsString = Bot.Message.text("What is your complaint?").addResponseKeyboard(["Cancel"], true)

				callback(ComplaintActionsString)
				break

			case "confirm_suggest":
				let ConfirmCreateUserInputSuggestString = Bot.Message.text("Are you sure this is all you want to say?").addResponseKeyboard(["Yes", "No"])

				callback(ConfirmCreateUserInputSuggestString)
				break

			case "confirm_complaint":
				let ConfirmCreateUserInputComplaintString = Bot.Message.text("Are you sure this is all you want to say?").addResponseKeyboard(["Yes", "No"])

				callback(ConfirmCreateUserInputComplaintString)
				break

			case "more":
				let moreString = Bot.Message.text("How can I help you?").addResponseKeyboard(["📲 Feedback", "ℹ️ Admins", "📊 Stats", "👥 Credits", "⚙ Settings", "🏠 Back to home"])

				callback(moreString)
				break

			case "peer_review":
				let PeerReviewString = Bot.Message.text("What would you like to do?").addResponseKeyboard(["Review a Document", "Submit a Document", "🏠 Back to home"])

				callback(PeerReviewString)
				break

			case "submit_document":
				let SubmitDocumentURLString = Bot.Message.text("Please paste the URL of the document below.").addResponseKeyboard(["Cancel"], true)

				callback(SubmitDocumentURLString)
				break

			case "submit_document_title":
				let SubmitDocumentTitleString = Bot.Message.text("What is the title of the document?").addResponseKeyboard(["Cancel"], true)

				callback(SubmitDocumentTitleString)
				break

			case "confirm_submit_document":
				let ConfirmSubmitDocumentString = Bot.Message.text("Is this information correct?").addResponseKeyboard(["Yes", "No"])

				callback(ConfirmSubmitDocumentString)
				break

			case "review_document":
				var docTitles = []
				peerRef.child("documents").limitToLast(19).orderByChild("negative_timestamp").on("child_added", function (snapshot)
				{
					docTitles.push(snapshot.val().title)
				})

				peerRef.child("documents").once("value", function (snapshot)
				{
					docTitles.push("🔙 To Peer Review")
					let ReviewDocumentString = Bot.Message.text("Here are all the documents submitted for reviewal. Click on one to be sent to its page.").addResponseKeyboard(docTitles)

					callback(ReviewDocumentString)
				})
				break

			case "homework":
				let homeworkContextMessage = Bot.Message.text("What class would you like to get the homework for?")
				var responses = ["Show all"]

				homeworkRef.child("items").once("value", function (snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						responses.push(childSnapshot.key)
					})

					responses.push("Back")
					homeworkContextMessage.addResponseKeyboard(responses)
					callback(homeworkContextMessage)
				})
				break

			case "add_homework_item":
			let addHomeworkItemClassesString = Bot.Message.text("What is the homework that you would like to add to that class?").addResponseKeyboard(["Cancel"], true)
			callback(addHomeworkItemClassesString)
			break

		}
	}

	function sendErrorMessage(message, errorType, callback)
	{
		if (typeof errorType === 'string')
		{
			switch (errorType)
			{
				case "context_error":
					bot.send(Bot.Message.text("There has been a fatal error. Please contact @pjtnt11 to get this issue resolved"), message.from)
					break
			}
		}
		if (typeof callback === 'function')
		{
			callback()
		}
	}


	function adminCheck(message, callback)
	{
		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)
		userRef.child("is_admin").once("value", function (snapshot)
		{
			callback(snapshot.val())
		})
	}


	function getHomeworkString(callback)
	{
		homeworkRef.child("items").once("value", function(snapshot)
		{
			var classHomework = "Here is all the homework for today:\n"

			snapshot.forEach(function(classSnapshot)
			{
				classHomework = classHomework + "\n" + classSnapshot.key + ":\n"

				classSnapshot.forEach(function(homeworkSnapshot)
				{
					classHomework = classHomework + homeworkSnapshot.val() + "\n"
				})
			})

		callback(classHomework)
		})
	}

	bot.onStartChattingMessage((message) =>
	{

		console.log(message.from + "\: \(started chatting\)")

		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		let sendingMessage = Bot.Message.text("Welcome to the Bartlett High School Academy Kik Bot!\n\nWith this bot you will be able to vote on current topics, receive daily homework information and get notified of announcements.\n\nThis bot was created from scratch by Patrick Stephen so if you have any questions, contact him at @pjtnt11")

		createUser(message, function (error)
		{
			if (error == null)
			{
				getContextMessage(message, "home", function (contextMessage)
				{
					bot.send([sendingMessage, contextMessage], message.from)
				})
			}
		})
	})

	bot.onPictureMessage((message) =>
	{

		message.markRead()

		console.log(message.from + ": (picture message) " + message.picUrl)

		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		userRef.once("value", function (snapshot)
		{
			if (!snapshot.exists())
			{
				createUser(message)
			}
		})

		userRef.child("context").once("value", function (snapshot)
		{
			if (snapshot.val() == "add_announcement_image")
			{
				var announcementData = {}
				announcementData["picture_url"] = message.picUrl
				announcementsRef.child("pending").child(encodedMessageFromUsername).update(announcementData)

				userRef.update(
				{
					context: "ask_change_from"
				})

				getContextMessage(message, "ask_change_from", function (contextMessage)
				{
					bot.send(contextMessage, message.from)
				})
			}
			else
			{
				resendContextMessage(message, snapshot.val())
			}
		})
	})

	bot.onVideoMessage((message) =>
	{
		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		userRef.once("value", function (snapshot)
		{
			if (!snapshot.exists())
			{
				createUser(message)
			}
		})

		message.markRead()

		console.log(message.from + ": (video message) " + message.videoUrl)

		userRef.child("context").once("value", function (snapshot)
		{
			resendContextMessage(message, snapshot.val())
		})
	})

	bot.onFriendPickerMessage((message) =>
	{

		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		userRef.once("value", function (snapshot)
		{
			if (!snapshot.exists())
			{
				createUser(message)
			}
		})

		message.markRead()

		console.log(message.from + ": (friend picker message) " + message.picked)

		userRef.child("context").once("value", function (snapshot)
		{
			let context = snapshot.val()
			if (context == "ask_change_from")
			{
				var data = {}
				data["from"] = message.picked[0]
				announcementsRef.child("pending").child(encodedMessageFromUsername).update(data)

				updateContext(message, encodedMessageFromUsername, "confirm_make_announcement")
			}
			else
			{
				resendContextMessage(message, snapshot.val())
			}
		})
	})

	bot.onScanDataMessage((message) =>
	{
		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		userRef.once("value", function (snapshot)
		{
			if (!snapshot.exists())
			{
				createUser(message)
			}
		})

		message.markRead()

		console.log(message.from + ": (scan data message) " + message.scanData)

		userRef.child("context").once("value", function (snapshot)
		{
			resendContextMessage(message, snapshot.val())
		})
	})

	bot.onStickerMessage((message) =>
	{
		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		userRef.once("value", function (snapshot)
		{
			if (!snapshot.exists())
			{
				createUser(message)
			}
		})

		message.markRead()

		console.log(message.from + ": (sticker message) " + message.stickerUrl)

		userRef.child("context").once("value", function (snapshot)
		{
			resendContextMessage(message, snapshot.val())
		})
	})

	bot.onTextMessage((message) =>
	{
		console.log(message.from + ": " + message.body)

		if (message.body != "")
		{
			message.markRead()
		}

		var encodedMessageFromUsername = message.from
		encodedMessageFromUsername = encodedMessageFromUsername.replace(/\./g, "%2E")

		let userRef = usersRef.child(encodedMessageFromUsername)

		userRef.child("context").once("value", function (snapshot)
		{
			context = snapshot.val()
			if (!snapshot.exists())
			{
				createUser(message)
			}

			var context = snapshot.val()
			if (message.mention == "bhsacademybot")
			{
				let mentionResponceKeyboard = ["Homework", "Latest Announcement", "Stats", "Admins"]
				switch (message.body)
				{
					case "homework":
					case "Homework":
					case "HOMEWORK":
						getHomeworkString(function (homeworkString)
						{
							message.reply([Bot.Message.text(homeworkString).addResponseKeyboard(mentionResponceKeyboard)])
						})
						break

					case "latest announcement":
					case "Latest Announcement":
						announcementsRef.child("items").limitToLast(1).once("value", function (snapshot)
						{
							snapshot.forEach(function(childSnapshot)
							{
								let announcementString = Bot.Message.text("Announcement from @" + childSnapshot.val().from + " - \n\n" + childSnapshot.val().title + ":\n\n" + childSnapshot.val().body).addResponseKeyboard(mentionResponceKeyboard)

								if (childSnapshot.val().picture_url !== undefined)
								{
									let picture = Bot.Message.picture(childSnapshot.val().picture_url)

									message.reply([announcementString, picture], message.from)
								}
								else
								{
									message.reply([announcementString], message.from)
								}
							})
						})
						break

					case "stats":
					case "Stats":
						var numRegisteredUsers = 0
						var numSubscribedUsers = 0
						var numAdmins = 0

						usersRef.on("child_added", function (snapshot)
						{
							if (snapshot.val().subscribed == true)
							{
								numSubscribedUsers++
							}
							if (snapshot.val().is_admin == true)
							{
								numAdmins++
							}
						})

						usersRef.once("value", function (snapshot)
						{
							numRegisteredUsers = snapshot.numChildren()
							let statsString = Bot.Message.text("There are currently " + numRegisteredUsers + " users registered in the database. Of those, " + numSubscribedUsers + " are subscribed and " + numAdmins + " are admins").addResponseKeyboard(mentionResponceKeyboard)

							message.reply([statsString], message.from)
						})
						break

					case "admins":
					case "Admins":
						var adminsString = "Here are the admins\n"
						var postAdminString = "Contact one of them if you are would like to create a poll or make an announcement"
						usersRef.on("child_added", function (snapshot)
						{
							if (snapshot.val().is_admin == true)
							{
								var decodedMessageFromUsername = snapshot.key
								decodedMessageFromUsername = decodedMessageFromUsername.replace(/%2E/g, "\.")
								adminsString = adminsString + "@" + snapshot.key + "\n"
							}
						})

						usersRef.once("value", function (snapshot)
						{
							adminsString = adminsString + "\n" + postAdminString
							usersRef.off("child_added")
							message.reply([Bot.Message.text(adminsString).addResponseKeyboard(mentionResponceKeyboard)])
						})
						break

					default:
						message.reply(Bot.Message.text("Sorry, I don't know what that means. Please use one of the following commands:\n\nHomework\nLatest Announcement\nStats\nAdmins").addResponseKeyboard(mentionResponceKeyboard))
						break
				}
			}
			else if (message.body == "Dismiss")
			{
				resendContextMessage(message, context)
			}
			else if (message.body == "View")
			{
				announcementsRef.child("items").orderByChild("negative_timestamp").limitToFirst(1).once("value", function (snapshot)
				{
					snapshot.forEach(function(childSnapshot)
					{
						let announcementString = Bot.Message.text(childSnapshot.val().body).addResponseKeyboard("Dismiss")

						if (childSnapshot.val().picture_url !== undefined)
						{
							let picture = Bot.Message.picture(childSnapshot.val().picture_url).addResponseKeyboard("Dismiss")
							bot.send([announcementString, picture], message.from)
						}
						else
						{
							bot.send([announcementString], message.from)
						}
					})
				})
			}
			else
			{
				switch (context)
				{

					case "home":
						///////////////////////////////
						// START "HOME" CONTEXT
						///////////////////////////////

						switch (message.body)
						{
							///////////////////////////////
							// START MESSAGE OPTIONS
							///////////////////////////////

							case "":
								message.ignore()
								break

							case "📝 Homework":
								updateContext(message, encodedMessageFromUsername, "homework")
								break

							case "🗂 More":
								updateContext(message, encodedMessageFromUsername, "more")
								break

							case "📄 Peer Review":
								updateContext(message, encodedMessageFromUsername, "peer_review")
								break

							case "🔒 Admin Actions":

								adminCheck(message, function (is_admin)
								{
									if (is_admin)
									{
										let adminNoteString = Bot.Message.text("Note: Only admins can access this page. If you want to see a list of the current admins, use the \"admins\" command")

										updateContext(message, encodedMessageFromUsername, "admin_actions")
									}
									else
									{
										resendContextMessage(message, context)
									}
								})

								break
							case "Latest Announcement":
							case "latest announcement":
							case "Latest announcement":
							case "📢 latest announcement":
							case "📢 Latest Announcement":
								announcementsRef.child("items").limitToLast(1).once("value", function (snapshot)
								{
									snapshot.forEach(function(childSnapshot)
									{
										let announcementString = "Announcement from @" + childSnapshot.val().from + " - \n\n" + childSnapshot.val().title + ":\n\n" + childSnapshot.val().body

										if (childSnapshot.val().picture_url !== undefined)
										{
											let picture = Bot.Message.picture(childSnapshot.val().picture_url)

											getContextMessage(message, context, function (contextMessage)
											{
												if (contextMessage !== null)
												{
													message.reply([announcementString, picture, contextMessage], message.from)
												}
												else
												{
													message.reply([announcementString, picture], message.from)
												}
											})
										}
										else
										{
											getContextMessage(message, context, function (contextMessage)
											{
												if (contextMessage !== null)
												{
													message.reply([announcementString, contextMessage], message.from)
												}
												else
												{
													message.reply([announcementString], message.from)
												}
											})
										}
									})
								})
								break

							case "📢 Announcements":
								updateContext(message, encodedMessageFromUsername, "announcements")
								break

							case "🗳 Voting":
								updateContext(message, encodedMessageFromUsername, "voting")
								break

							default:
								resendContextMessage(message, context)
								break
						}
						///////////////////////////////
						// END MESSAGE OPTIONS
						///////////////////////////////

						break
						///////////////////////////////
						// END "HOME" CONTEXT
						///////////////////////////////

					case "settings":
						///////////////////////////////
						// START "SETTINGS" CONTEXT
						///////////////////////////////

						switch (message.body)
						{
							///////////////////////////////
							// START MESSAGE OPTIONS
							///////////////////////////////

							case "subscribe":
							case "Subscribe":

								userRef.once("value", function (snapshot)
								{
									if (!snapshot.exists())
									{
										createUser(message)
									}

									userRef.update(
									{
										context: "more"
									})
								})

								let subscribeSuccessText = Bot.Message.text("You are now subscribed to receive homework and announcement notifications")
								let subscribeErrorText = Bot.Message.text("You are already subscribed to receive homework and announcement notifications")

								userRef.child("subscribed").once("value", function (snapshot)
								{
									if (!snapshot.exists())
									{
										createUser(message)
									}

									if (snapshot.val() === true)
									{
										getContextMessage(message, "more", function (contextMessage)
										{
											bot.send([subscribeErrorText, contextMessage], message.from)
										})
									}
									else
									{
										userRef.update(
										{
											subscribed: true
										})

										getContextMessage(message, "home", function (contextMessage)
										{
											bot.send([subscribeSuccessText, contextMessage], message.from)
										})
									}
								})
								break

							case "unsubscribe":
							case "Unsubscribe":

								userRef.update(
								{
									context: "more"
								})

								let unsubscribeSuccessText = Bot.Message.text("You are now unsubscribed")
								let unsubscribeErrorText = Bot.Message.text("You already aren't subscribed to receive homework and announcement notifications")

								userRef.child("subscribed").once("value", function (snapshot)
								{
									if (snapshot.val() === false)
									{
										getContextMessage(message, "more", function (contextMessage)
										{
											if (contextMessage !== null)
											{
												bot.send([unsubscribeErrorText, contextMessage], message.from)
											}
											else
											{
												bot.send([unsubscribeErrorText], message.from)
											}
										})
									}
									else
									{
										userRef.update(
										{
											subscribed: false
										})
										getContextMessage(message, "more", function (contextMessage)
										{
											if (contextMessage !== null)
											{
												bot.send([unsubscribeSuccessText, contextMessage], message.from)
											}
											else
											{
												bot.send([unsubscribeSuccessText], message.from)
											}
										})
									}
								})
								break

							case "cancel":
							case "Cancel":

								userRef.update(
								{
									context: "more"
								})

								getContextMessage(message, "more", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							default:
								getContextMessage(message, context, function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break
						}

						break
						///////////////////////////////
						// END "SETTINGS" CONTEXT
						///////////////////////////////
					case "homework":
						if (message.body == "Back")
						{
							updateContext(message, encodedMessageFromUsername, "home")
						}
						else if(message.body == "Show all")
						{
							getHomeworkString(function(homework)
							{
								getContextMessage(message, context, function (contextMessage)
								{
									bot.send([homework, contextMessage], message.from)
								})
							})
						}
						else
						{
							homeworkRef.child("items").child(message.body).once("value", function(snapshot)
							{
								if (snapshot.exists())
								{
									var classHomework = "Here is the homework in " + snapshot.key + ":\n"

									snapshot.forEach(function(childSnapshot)
									{
										classHomework = classHomework + "\n" + childSnapshot.val()
									})

									getContextMessage(message, context, function (contextMessage)
									{
										bot.send([classHomework, contextMessage], message.from)
									})
								}
								else
								{
									resendContextMessage(message, context)
								}
							})
						}
						break

					case "admin_actions":
						///////////////////////////////
						// START "ADMIN ACTIONS" CONTEXT
						///////////////////////////////

						switch (message.body)
						{
							case "back":
							case "Back":
							case "🔙":
							case "🏠 Back to home":
								userRef.update(
								{
									context: "home"
								})

								getContextMessage(message, "home", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "Homework":
							case "homework":
								userRef.update(
								{
									context: "homework_actions"
								})

								getContextMessage(message, "homework_actions", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "Voting":
							case "voting":
								userRef.update(
								{
									context: "voting_actions"
								})

								getContextMessage(message, "voting_actions", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "Make an announcement":

								userRef.update(
								{
									context: "make_an_announcement"
								})

								getContextMessage(message, "make_an_announcement", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							default:
								resendContextMessage(message, context)
								break
						}
						break
						///////////////////////////////
						// END "ADMIN ACTIONS" CONTEXT
						///////////////////////////////

					case "more":
						switch (message.body)
						{
							case "ℹ️ Admins":
								var adminsString = "Here are the admins\n"
								var postAdminString = "Contact one of them if you are would like to create a poll or make an announcement"
								usersRef.orderByChild("is_admin").equalTo(true).once("value", function (snapshot)
								{
									snapshot.forEach(function(childSnapshot)
									{
										var decodedMessageFromUsername = childSnapshot.key
										decodedMessageFromUsername = decodedMessageFromUsername.replace(/%2E/g, "\.")
										adminsString = adminsString + "@" + decodedMessageFromUsername + "\n"
									})

									adminsString = adminsString + "\n" + postAdminString

									getContextMessage(message, context, function (contextMessage)
									{
										if (contextMessage != null)
										{
											message.reply([Bot.Message.text(adminsString), contextMessage])
										}
										else
										{
											message.reply([Bot.Message.text(adminsString)])
										}
									})
								})
								break

							case "settings":
							case "Settings":
							case "⚙":
							case "⚙ settings":
							case "⚙ Settings":
								userRef.update(
								{
									context: "settings"
								})

								getContextMessage(message, "settings", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "📊 Stats":
							case "Stats":
							case "stats":
								var numRegisteredUsers = 0
								var numSubscribedUsers = 0
								var numAdmins = 0

								usersRef.once("value", function (snapshot)
								{
									numRegisteredUsers = snapshot.numChildren()
									snapshot.forEach(function(childSnapshot)
									{
										if (childSnapshot.child("subscribed").val())
										{
										numSubscribedUsers++
										}

										if (childSnapshot.child("is_admin").val())
										{
										numAdmins++
										}
									})

									let statsString = Bot.Message.text("There are currently " + numRegisteredUsers + " users registered in the database. Of those, " + numSubscribedUsers + " are subscribed and " + numAdmins + " are admins")

									getContextMessage(message, "more", function (contextMessage)
									{
										if (contextMessage != null)
										{
											message.reply([statsString, contextMessage], message.from)
										}
										else
										{
											message.reply([statsString], message.from)
										}
									})
								})
								break

							case "📲 Feedback":
							case "Feedback":
							case "feedback":
							case "📲":
								userRef.update(
								{
									context: "feedback"
								})

								getContextMessage(message, "feedback", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "🏠 Back to home":
								userRef.update(
								{
									context: "home"
								})

								getContextMessage(message, "home", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "👥 Credits":
								let creditsText = "This bot was programed from scratch by Patrick Stephen.\n\nThanks to Jack Locascio for helping with some of the programing.\n\nAlso, thanks to all of the bot admins for helping with testing, suggesting features and helping manage the bot.\n\nAnd thank you to eveyone else for using the bot and providing feedback"
								getContextMessage(message, context, function (contextMessage)
								{
									bot.send([creditsText, contextMessage], message.from)
								})
								break

							default:
								resendContextMessage(message, context)
								break
						}
						break

					case "voting":
						var pollTitles = []
						votingRef.child("polls").child("active").orderByChild("title").equalTo(message.body).limitToFirst(1).once("value", function (snapshot)
						{
							if (snapshot.exists())
							{
								snapshot.forEach(function(childSnapshot)
								{
									let pollRef = votingRef.child("polls").child("active").child(childSnapshot.key)
									if (!childSnapshot.child("voters").child(encodedMessageFromUsername).exists())
									{
										var data = {}
										data[encodedMessageFromUsername] = "pending"
										pollRef.child("voters").update(data)

										updateContext(message, encodedMessageFromUsername, "vote")
									}
									else
									{
										var votingResultString = "Here are the current results for this poll:\n\n"

										childSnapshot.child("items").forEach(function(childSnapshot)
										{
											var decodedPollResponce = childSnapshot.key
											decodedPollResponce = decodedPollResponce.replace(/%2E/g, "\.")
											votingResultString = votingResultString + decodedPollResponce + ":\n" + childSnapshot.val() + "\n\n"
										})

										getContextMessage(message, context, function (contextMessage)
										{
											bot.send([votingResultString, contextMessage], message.from)
										})
									}
								})
							}
							else
							{
								switch (message.body)
								{
									case "Back":
										updateContext(message, encodedMessageFromUsername, "home")
										break

									default:
										resendContextMessage(message, context)
										break
									}
								}
						})
						break

					case "announcements":

						announcementsRef.child("items").orderByChild("title").equalTo(message.body).limitToFirst(1).once("value", function (snapshot)
						{
							if (snapshot.exists())
							{
								snapshot.forEach(function(childSnapshot)
								{
									let announcementString = "Announcement from @" + childSnapshot.val().from + " -\n\n" + childSnapshot.val().body

									if (childSnapshot.val().picture_url !== undefined)
									{

										let picture = Bot.Message.picture(childSnapshot.val().picture_url)

										getContextMessage(message, context, function (contextMessage)
										{
											if (contextMessage !== null)
											{
												bot.send([announcementString, picture, contextMessage], message.from)
											}
											else
											{
												bot.send([announcementString, picture], message.from)
											}
										})
									}
									else
									{
										getContextMessage(message, context, function (contextMessage)
										{
											if (contextMessage !== null)
											{
												bot.send([announcementString, contextMessage], message.from)
											}
											else
											{
												bot.send([announcementString], message.from)
											}
										})
									}
								})
							}
							else
							{
								if (message.body == "Back")
								{
									userRef.update
									({
										context: "home"
									})

									getContextMessage(message, "home", function (contextMessage)
									{
										bot.send(contextMessage, message.from)
									})
								}
								else
								{
									resendContextMessage(message, context)
								}
							}
						})
						break

					case "vote":

						var pollRef = votingRef
						var pollMatch = false

						votingRef.child("polls").child("active").on("child_added", function (snapshot)
						{
							if (snapshot.child("voters").child(encodedMessageFromUsername).val() == "pending")
							{
								pollRef = votingRef.child("polls").child("active").child(snapshot.key)
								pollMatch = true
							}
						})

						pollRef.once("value", function()
						{
							if (message.body == "Cancel")
							{
								pollRef.once("value", function(snapshot)
								{
									if (pollMatch)
									{
										pollRef.child("voters").child(encodedMessageFromUsername).set(null)
									}
								})

								updateContext(message, encodedMessageFromUsername, "voting")
							}
							else
							{
								var encodedItemName = message.body
								encodedItemName = encodedItemName.replace(/\./g, "%2E")
								encodedItemName = encodedItemName.replace(/\$/g, "%24")
								encodedItemName = encodedItemName.replace(/#/g, "%23")

								pollRef.child("items").once("value", function(snapshot)
								{
									if (snapshot.child(encodedItemName).exists())
									{
										var voteData = {}
										voteData[encodedItemName] = snapshot.child(encodedItemName).val() + 1
										pollRef.child("items").update(voteData)

										var voterData = {}
										voterData[encodedMessageFromUsername] = message.body
										pollRef.child("voters").update(voterData)

										userRef.update(
										{
												context: "voting"
										})

										var votingResultString = "Thank you for voting!\n\nHere are the current results for this poll:\n\n"

										pollRef.child("items").once("value", function(snapshot)
										{
											snapshot.forEach(function(childSnapshot)
											{
												var decodedPollResponce = childSnapshot.key
												decodedPollResponce = decodedPollResponce.replace(/%2E/g, "\.")
												votingResultString = votingResultString + decodedPollResponce + " - " + childSnapshot.val() + "\n"
											})
										})

										getContextMessage(message, "voting", function (contextMessage)
										{
											bot.send([votingResultString, contextMessage], message.from)
										})
									}
									else
									{
										resendContextMessage(message, context)
									}
								})
							}
						})
						break

					case "homework_actions":
						switch (message.body)
						{
							case "Add homework item":
								updateContext(message, encodedMessageFromUsername, "add_homework_item_classes")
								break

							case "Show homework":
							case "homework":
							case "Homework":
								getHomeworkString(function (homeworkString)
								{
									getContextMessage(message, context, function (contextMessage)
									{
										if (contextMessage != null)
										{
											bot.send([Bot.Message.text(homeworkString), contextMessage], message.from)
										}
										else
										{
											bot.send([Bot.Message.text(homeworkString)], message.from)
										}
									})
								})

								break

							case "Remove homework item":
								userRef.update(
								{
									context: "remove_homework_item_class"
								})

								getContextMessage(message, "remove_homework_item_class", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "Manually clear homework":
								userRef.update(
								{
									context: "clear_homework"
								})

								getContextMessage(message, "clear_homework", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "Enable homework auto clear":
								userRef.update(
								{
									context: "enable_homework_auto_clear"
								})

								getContextMessage(message, "enable_homework_auto_clear", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "Disable homework auto clear":
								userRef.update(
								{
									context: "disable_homework_auto_clear"
								})

								getContextMessage(message, "disable_homework_auto_clear", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "Enable homework notifications":
								userRef.update(
								{
									context: "enable_homework_notifications"
								})

								getContextMessage(message, "enable_homework_notifications", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "Disable homework notifications":
								userRef.update(
								{
									context: "disable_homework_notifications"
								})

								getContextMessage(message, "disable_homework_notifications", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "🔙 To Admin Actions":
								userRef.update(
								{
									context: "admin_actions"
								})

								getContextMessage(message, "admin_actions", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							default:
								resendContextMessage(message, context)
								break
						}
						break

					case "add_poll_title":
						if (message.body == "Cancel")
						{
							votingRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "voting_actions"
							})

							getContextMessage(message, "voting_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							let data = {}
							data["title"] = message.body
							votingRef.child("pending").child(encodedMessageFromUsername).update(data)

							userRef.update(
							{
								context: "create_a_poll"
							})

							getContextMessage(message, "create_a_poll", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "voting_actions":
						switch (message.body)
						{

							case "Create a poll":
								userRef.update(
								{
									context: "add_poll_title"
								})

								getContextMessage(message, "add_poll_title", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "End a poll":
								userRef.update(
								{
									context: "end_a_poll"
								})

								getContextMessage(message, "end_a_poll", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "🔙 To Admin Actions":
								userRef.update(
								{
									context: "admin_actions"
								})

								getContextMessage(message, "admin_actions", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break
						}
						break

					case "feedback":
						switch (message.body)
						{

							case "Suggestion":
								userRef.update(
								{
									context: "suggestion"
								})

								getContextMessage(message, "suggestion", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "Complaint":
								userRef.update(
								{
									context: "complaint"
								})

								getContextMessage(message, "complaint", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							case "🏠 Back to Home":
								userRef.update(
								{
									context: "home"
								})

								getContextMessage(message, "home", function (contextMessage)
								{
									bot.send([contextMessage], message.from)
								})
								break

							default:
								resendContextMessage(message, context)
								break
						}
						break

					case "clear_homework":
						if (message.body == "Yes")
						{

							homeworkRef.child("items").set(null)

							userRef.update(
							{
								context: "homework_actions"
							})

							let clearedAllHomeworkString = "Homework has been cleared"
							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([clearedAllHomeworkString, contextMessage], message.from)
							})
						}
						else if (message.body == "No")
						{
							homeworkRef.child("pending_items").child(encodedMessageFromUsername).set(null)

							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "enable_homework_notifications":
						if (message.body == "Yes")
						{

							homeworkRef.update(
							{
								notifications_enabled: true
							})

							userRef.update(
							{
								context: "homework_actions"
							})

							let EnableHomeworkNotificationsString = "Homework notifications has been enabled"

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([EnableHomeworkNotificationsString, contextMessage], message.from)
							})
						}
						else if (message.body == "No")
						{

							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([contextMessage], message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "disable_homework_notifications":
						if (message.body == "Yes")
						{

							homeworkRef.update(
							{
								notifications_enabled: false
							})

							userRef.update(
							{
								context: "homework_actions"
							})

							let DisableHomeworkNotificationsString = "Homework notifications has been disabled"

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([DisableHomeworkNotificationsString, contextMessage], message.from)
							})
						}
						else if (message.body == "No")
						{

							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([contextMessage], message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "enable_homework_auto_clear":
						if (message.body == "Yes")
						{

							homeworkRef.update(
							{
								auto_clear_enabled: true
							})

							userRef.update(
							{
								context: "homework_actions"
							})

							let EnableHomeworkAutoClearString = "Homework auto clear has been enabled"

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([EnableHomeworkAutoClearString, contextMessage], message.from)
							})
						}
						else if (message.body == "No")
						{

							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([contextMessage], message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "end_a_poll":
						var titleMatch = false
						var pollRef = votingRef.child("polls")

						votingRef.child("polls").child("active").orderByChild("title").equalTo(message.body).limitToFirst(1).once("value", function (snapshot)
						{
							if(snapshot.exists())
							{
								snapshot.forEach(function(childSnapshot)
								{
									let pendingVoters = []

									childSnapshot.child("voters").forEach(function(childSnapshot)
									{
											if (snapshot.val() == "pending")
											{
												var decodedMessageFromUsername = childSnapshot.key
												decodedMessageFromUsername = decodedMessageFromUsername.replace(/%2E/g, "\.")
												pendingVoters.push(decodedMessageFromUsername)
											}
									})

									getContextMessage(message, "voting_actions", function (contextMessage)
									{
										if (pendingVoters.length != 0)
										{
											bot.broadcast(["Sorry, this poll has been deactivated", contextMessage], pendingVoters)
										}
									})

									pendingVoters.forEach(function (userName)
									{
										var encodedUsersUsername = userName
										encodedUsersUsername = encodedUsersUsername.replace(/\./g, "%2E")
										usersRef.child(encodedUsersUsername).update(
										{
											context: "voting_options"
										})
									})

									var data = {}
									data[childSnapshot.key] = childSnapshot.val()
									votingRef.child("polls").child("deactivated").update(data)
									votingRef.child("polls").child("active").child(childSnapshot.key).set(null)

									userRef.update(
									{
										context: "voting_actions"
									})

									getContextMessage(message, "voting_actions", function (contextMessage)
									{
										bot.send([contextMessage], message.from)
									})
								})
							}
							else
							{
								switch(message.body)
								{
									case "🔙 To Voting Actions":
										updateContext(message, encodedMessageFromUsername, "voting_actions")
										break

									default:
										resendContextMessage(message, context)
										break
								}
							}
						})
						break

					case "disable_homework_auto_clear":
						if (message.body == "Yes")
						{

							homeworkRef.update(
							{
								auto_clear_enabled: false
							})

							let DisableHomeworkAutoClearString = "Homework auto clear has been disabled"

							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([DisableHomeworkAutoClearString, contextMessage], message.from)
							})
						}
						else if (message.body == "No")
						{

							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send([contextMessage], message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "add_homework_item_classes":
						if (message.body != "Cancel")
						{
							var data = {}
							data[encodedMessageFromUsername] = message.body
							homeworkRef.child("pending_items").update(data)

							updateContext(message, encodedMessageFromUsername, "add_homework_item_body")
						}
						else
						{
							updateContext(message, encodedMessageFromUsername, "homework_actions")
						}
					break

					case "add_homework_item":

						if (message.body != "Cancel" && message.body != "cancel")
						{
							var homeworkData = {}

							homeworkRef.child("items").child(message.body).once("value", function (snapshot)
							{
								if (snapshot.exists())
								{
									homeworkData[message.from] = message.body
									homeworkRef.child("pending_items").set(homeworkData)

									userRef.update(
									{
										context: "confirm_add_homework_item"
									})

									getContextMessage(message, "confirm_add_homework_item", function (contextMessage)
									{
										bot.send(contextMessage, message.from)
									})
								}
								else
								{
									homeworkData[message.from] = message.body
									homeworkRef.child("pending_items").set(homeworkData)

									userRef.update(
									{
										context: "add_homework_item_body"
									})

									getContextMessage(message, "add_homework_item_body", function (contextMessage)
									{
										bot.send(contextMessage, message.from)
									})
								}
							})
						}
						else
						{
							userRef.update(
							{
								context: "admin_actions"
							})

							getContextMessage(message, "admin_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "add_homework_item_body":

						if (message.body != "Cancel" && message.body != "cancel")
						{
							let addedHomeworkConfirmation = "Homework item added"
							var homeworkData = {}

							homeworkRef.child("pending_items").child(encodedMessageFromUsername).once("value", function (snapshot)
							{
								let homeworkItem = "• " + message.body
								homeworkRef.child("items").child(snapshot.val()).push().set(homeworkItem)
								homeworkRef.child("pending_items").child(encodedMessageFromUsername).set(null)
							})

							updateContext(message, encodedMessageFromUsername, "homework_actions")
						}
						else
						{
							userRef.update(
							{
								context: "homework_actions"
							})

							getContextMessage(message, "homework_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "remove_homework_item":
					if (message.body != "Cancel")
					{
						homeworkRef.child("pending_removal").child(encodedMessageFromUsername).once("value", function(snapshot)
						{
							let pendingRemovalClass = snapshot.val()
							homeworkRef.child("items").child(pendingRemovalClass).once("value", function(snapshot)
							{
								snapshot.forEach(function(childSnapshot)
								{
									if(message.body == childSnapshot.val())
									{
										homeworkRef.child("items").child(pendingRemovalClass).child(childSnapshot.key).set(null)
										homeworkRef.child("pending_removal").child(encodedMessageFromUsername).set(null)
										updateContext(message, encodedMessageFromUsername, "homework_actions")
									}
								})
							})
						})
					}
					else
					{
						homeworkRef.child("pending_removal").child("encodedMessageFromUsername").set(null)
						updateContext(message, encodedMessageFromUsername, "homework_actions")
					}
					break

					case "remove_homework_item_class":
						if (message.body != "Cancel")
						{
							homeworkRef.child("items").child(message.body).once("value", function (snapshot)
							{
								if (snapshot.exists())
								{
									homeworkRef.child("pending_removal").child(encodedMessageFromUsername).set(message.body)
									updateContext(message, encodedMessageFromUsername, "remove_homework_item")
								}
								else
								{
									getContextMessage(message, "remove_homework_item_class", function (contextMessage)
									{
										bot.send([contextMessage], message.from)
									})
								}
							})
						}
						else
						{
							updateContext(message, encodedMessageFromUsername, "homework_actions")
						}
						break

					case "confirm_add_homework_item":
						var homeworkData = {}

						if (message.body == "Yes")
						{
							updateContext(message, encodedMessageFromUsername, "add_homework_item_body")
						}
						else if (message.body == "No")
						{
							homeworkRef.child("pending_items").child(encodedMessageFromUsername).set(null)

							updateContext(message, encodedMessageFromUsername, "homework_actions")
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "make_an_announcement":
						if (message.body != "Cancel")
						{
							var announcementData = {}
							announcementData["title"] = message.body
							announcementsRef.child("pending").child(encodedMessageFromUsername).update(announcementData)

							userRef.update(
							{
								context: "add_announcement_body"
							})

							getContextMessage(message, "add_announcement_body", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							userRef.update(
							{
								context: "admin_actions"
							})

							getContextMessage(message, "admin_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "ask_change_from":
						if (message.body == "No")
						{
							var data = {}
							data["from"] = message.from
							announcementsRef.child("pending").child(encodedMessageFromUsername).update(data)

							userRef.update(
							{
								context: "confirm_make_announcement"
							})

							getContextMessage(message, "confirm_make_announcement", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "add_announcement_body":
						if (message.body != "Cancel")
						{
							var announcementData = {}
							announcementData["body"] = message.body
							announcementsRef.child("pending").child(encodedMessageFromUsername).update(announcementData)

							userRef.update(
							{
								context: "ask_announcement_image"
							})

							getContextMessage(message, "ask_announcement_image", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							announcementsRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "admin_actions"
							})

							getContextMessage(message, "admin_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "add_announcement_image":
						if (message.body == "Cancel")
						{
							announcementsRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "admin_actions"
							})

							getContextMessage(message, "admin_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "ask_announcement_image":

						if (message.body == "Yes")
						{
							userRef.update(
							{
								context: "add_announcement_image"
							})

							getContextMessage(message, "add_announcement_image", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else if (message.body == "No")
						{
							userRef.update(
							{
								context: "ask_change_from"
							})

							getContextMessage(message, "ask_change_from", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "create_a_poll":
						if (message.body == "Cancel")
						{
							votingRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "voting_actions"
							})

							getContextMessage(message, "voting_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else if (message.body == "Done")
						{
							userRef.update(
							{
								context: "ask_make_poll_announcement"
							})

							getContextMessage(message, "ask_make_poll_announcement", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							var encodedVoteResponce = message.body
							encodedVoteResponce = encodedVoteResponce.replace(/\./g, "%2E")
							encodedVoteResponce = encodedVoteResponce.replace(/\$/g, "%24")
							encodedVoteResponce = encodedVoteResponce.replace(/#/g, "%23")

							let data = {}

							data[encodedVoteResponce] = true
							votingRef.child("pending").child(encodedMessageFromUsername).child("items").update(data)

							bot.send(Bot.Message.text("\"" + message.body + "\" added").addResponseKeyboard(["Done", "Cancel"], true), message.from)
						}
						break

					case "confirm_create_poll":
						if (message.body == "Yes")
						{
							let pollRef = votingRef.child("polls").child("active").push()
							var timestamp = {}
							var data = {}
							timestamp["negative_timestamp"] = (new Date() / 1000) * -1
							pollRef.update(timestamp)

							votingRef.child("pending").child(encodedMessageFromUsername).child("items").once("value", function (snapshot)
							{
								snapshot.forEach(function(childSnapshot)
								{
									data[childSnapshot.key] = 0
									pollRef.child("items").update(data)
								})
							})

							votingRef.child("pending").child(encodedMessageFromUsername).child("title").once("value", function (snapshot)
							{
								let makeAnnouncement = false

								votingRef.child("pending").child(encodedMessageFromUsername).child("make_announcement").once("value", function (snapshot)
								{
									let makeAnnouncement = snapshot.val()
								})

								var data = {}
								data["title"] = snapshot.val()
								data["from"] = message.from
								pollRef.update(data)
								votingRef.child("pending").child(encodedMessageFromUsername).set(null)

								var subscribers = []

								usersRef.once("value", function (snapshot)
								{
									snapshot.forEach(function(childSnapshot)
									{
										if (snapshot.val().subscribed == true && snapshot.key !== encodedMessageFromUsername)
										{
											var decodedMessageFromUsername = snapshot.key
											decodedMessageFromUsername = decodedMessageFromUsername.replace(/%2E/g, "\.")

											subscribers.push(decodedMessageFromUsername)
										}
									})
								})

								usersRef.once("value", function (snapshot)
								{

									userRef.update(
									{
										context: "voting_actions"
									})

									usersRef.off("child_added")

									let votingAnnouncementString = Bot.Message.text("A new poll has been created by @" + message.from + " with the question \"" + data["title"] + "\" go cast your vote in the voting menu!").addResponseKeyboard(["Dismiss"])
									if (makeAnnouncement)
									{
										bot.broadcast(votingAnnouncementString, subscribers)
									}
									getContextMessage(message, "voting_actions", function (contextMessage)
									{
										bot.send(["Poll created", contextMessage], message.from)
									})
								})
							})
						}
						else if (message.body == "No")
						{
							votingRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "voting_actions"
							})

							getContextMessage(message, "voting_actions", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							resendContextMessage(message, context)
						}
						break

					case "ask_make_poll_announcement":
						if (message.body == "Yes")
						{

							var data = {}
							data["make_announcement"] = true

							votingRef.child("pending").child(encodedMessageFromUsername).update(data)

							userRef.update(
							{
								context: "confirm_create_poll"
							})

							getContextMessage(message, "confirm_create_poll", function (contextMessage)
							{
								bot.send([contextMessage], message.from)
							})
						}
						else if (message.body == "No")
						{
							var data = {}
							data["make_announcement"] = false
							votingRef.child("pending").child(encodedMessageFromUsername).update(data)
							userRef.update(
							{
								context: "confirm_create_poll"
							})

							getContextMessage(message, "confirm_create_poll", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							getContextMessage(message, context, function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "voting_options":
						switch (message.body)
						{
							case "Vote for a poll":
								userRef.update(
								{
									context: "voting"
								})

								getContextMessage(message, "voting", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "View poll results":
								updateContext(message, encodedMessageFromUsername, "view_poll_results")
								break

							case "🏠 Back to home":
								userRef.update(
								{
									context: "home"
								})

								getContextMessage(message, "home", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							default:
								getContextMessage(message, context, function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break
						}
						break

					case "view_poll_results":

						votingRef.child("polls").child("active").orderByChild("title").equalTo(message.body).once("value", function (snapshot)
						{
							if (snapshot.exists())
							{
								snapshot.forEach(function(childSnapshot)
								{
									if (childSnapshot.child("voters").child(encodedMessageFromUsername).exists())
									{
										var votingResultString = "Here are the current results for this poll:\n\n"

										childSnapshot.child("items").forEach(function(childSnapshot)
										{
											var decodedPollResponce = childSnapshot.key
											decodedPollResponce = decodedPollResponce.replace(/%2E/g, "\.")
											votingResultString = votingResultString + decodedPollResponce + " - " + childSnapshot.val() + "\n"
										})

										getContextMessage(message, context, function (contextMessage)
										{
											bot.send([votingResultString, contextMessage], message.from)
										})
									}
									else
									{
										getContextMessage(message, "view_poll_results", function (contextMessage)
										{
											let viewVotingErrorString = "You must vote for this poll before you can view its results"
											bot.send([viewVotingErrorString, contextMessage], message.from)
										})
									}
								})
							}
							else
							{
								switch (message.body)
								{
									case "🔙 To Voting Options":
										userRef.update(
										{
											context: "voting_options"
										})

										getContextMessage(message, "voting_options", function (contextMessage)
										{
											bot.send([contextMessage], message.from)
										})
										break

									default:
										getContextMessage(message, context, function (contextMessage)
										{
											bot.send([contextMessage], message.from)
										})
										break
								}
							}
						})
						break

					case "confirm_make_announcement":
						if (message.body == "Yes")
						{
							announcementsRef.child("pending").child(encodedMessageFromUsername).once("value", function (snapshot)
							{
								let announcementRef = announcementsRef.child("items").push()

								let announcementItems = []
								var announcementData = snapshot.val()
								announcementData["negative_timestamp"] = (new Date() / 1000) * -1
								announcementRef.update(announcementData)

								announcementItems.push(Bot.Message.text("New announcement from @" + snapshot.val().from + " - \n\n" + snapshot.val().title + "\n\nWould you like to view it?").addResponseKeyboard(["View", "Dismiss"]))

								var subscribers = []

								usersRef.orderByChild("subscribed").equalTo(true).once("value", function (snapshot)
								{
									snapshot.forEach(function (childSnapshot)
									{
										if (childSnapshot.key != encodedMessageFromUsername)
										{
											var decodedMessageFromUsername = childSnapshot.key
											decodedMessageFromUsername = decodedMessageFromUsername.replace(/%2E/g, "\.")

											subscribers.push(decodedMessageFromUsername)
										}
									})

									bot.broadcast(announcementItems, subscribers)

									announcementsRef.child("pending").child(encodedMessageFromUsername).set(null)

									let announcementSentConfirmation = "Your announcement has been sent to " + subscribers.length + " users"

									userRef.update(
									{
										context: "admin_actions"
									})

									getContextMessage(message, "admin_actions", function (contextMessage)
									{
										bot.send([announcementSentConfirmation, contextMessage], message.from)
									})
								})
							})
						}
						else if (message.body == "No")
						{
							announcementsRef.child("pending").child(encodedMessageFromUsername).set(null)

							updateContext(message, encodedMessageFromUsername, "admin_actions")
						}
						else
						{
							getContextMessage(message, context, function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "suggestion":
						var suggestRef = feedbackRef.child("suggestions")

						if (message.body == "Cancel")
						{
							suggestRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "feedback"
							})

							getContextMessage(message, "feedback", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							let data = {}
							data["body"] = message.body
							suggestRef.child("pending").child(encodedMessageFromUsername).update(data)

							updateContext(message, encodedMessageFromUsername, "confirm_suggest")
						}
						break

					case "complaint":
						var complaintRef = feedbackRef.child("complaints")

						if (message.body == "Cancel")
						{
							complaintRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "feedback"
							})

							getContextMessage(message, "feedback", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							let data = {}
							data["body"] = message.body
							complaintRef.child("pending").child(encodedMessageFromUsername).update(data)

							userRef.update(
							{
								context: "confirm_complaint"
							})

							getContextMessage(message, "confirm_complaint", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "confirm_suggest":
						if (message.body == "Yes")
						{
							let suggestRef = feedbackRef.child("suggestions").child("items").push()

							feedbackRef.child("suggestions").child("pending").child(encodedMessageFromUsername).child("body").once("value", function (snapshot)
							{
								var data = {}
								data["timestamp"] = (new Date() / 1000)
								data["suggestion"] = snapshot.val()
								data["from"] = message.from
								suggestRef.update(data)

								feedbackRef.child("suggestions").child("pending").child(encodedMessageFromUsername).set(null)

								userRef.update(
								{
									context: "more"
								})

								getContextMessage(message, "more", function (contextMessage)
								{
									bot.send(["Thanks for the suggestion! We'll review it and hopefully add it as soon as we can.", contextMessage], message.from)
								})
							})
						}
						else if (message.body == "No")
						{
							feedbackRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "suggestion"
							})

							getContextMessage(message, "suggestion", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							getContextMessage(message, context, function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "confirm_complaint":
						if (message.body == "Yes")
						{
							let complaintRef = feedbackRef.child("complaints").child("items").push()
							var data = {}

							feedbackRef.child("complaints").child("pending").child(encodedMessageFromUsername).child("body").once("value", function (snapshot)
							{
								var data = {}
								data["timestamp"] = (new Date() / 1000)
								data["body"] = snapshot.val()
								data["from"] = message.from
								complaintRef.update(data)
								feedbackRef.child("complaints").child("pending").child(encodedMessageFromUsername).set(null)

								userRef.update(
								{
									context: "more"
								})

								getContextMessage(message, "more", function (contextMessage)
								{
									bot.send(["Sorry about that :/ We will get to fixing it right away!", contextMessage], message.from)
								})
							})
						}
						else if (message.body == "No")
						{
							feedbackRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "complaint"
							})

							getContextMessage(message, "complaint", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							getContextMessage(message, context, function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "peer_review":
						switch (message.body)
						{
							case "Review a Document":
								userRef.update(
								{
									context: "review_document"
								})

								getContextMessage(message, "review_document", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "Submit a Document":
								userRef.update(
								{
									context: "submit_document"
								})

								getContextMessage(message, "submit_document", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							case "🏠 Back to home":
								userRef.update(
								{
									context: "home"
								})

								getContextMessage(message, "home", function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break

							default:
								getContextMessage(message, context, function (contextMessage)
								{
									bot.send(contextMessage, message.from)
								})
								break
						}
						break

					case "submit_document":
						if (message.body == "Cancel")
						{
							peerRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "peer_review"
							})

							getContextMessage(message, "peer_review", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							let data = {}
							data["url"] = message.body
							data["from"] = message.from

							peerRef.child("pending").child(encodedMessageFromUsername).update(data)

							userRef.update(
							{
								context: "submit_document_title"
							})

							getContextMessage(message, "submit_document_title", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "submit_document_title":
						if (message.body == "Cancel")
						{
							peerRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "submit_document"
							})

							getContextMessage(message, "submit_document", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							let data = {}
							data["title"] = message.body
							peerRef.child("pending").child(encodedMessageFromUsername).update(data)

							userRef.update(
							{
								context: "confirm_submit_document"
							})

							getContextMessage(message, "confirm_submit_document", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "confirm_submit_document":
						if (message.body == "Yes")
						{
							let docRef = peerRef.child("documents").push()

							peerRef.child("pending").child(encodedMessageFromUsername).once("value", function (snapshot)
							{
								var data = snapshot.val()
								data["negative_timestamp"] = (new Date() / 1000)
								docRef.update(data)


								peerRef.child("pending").child(encodedMessageFromUsername).set(null)

								usersRef.on("child_added", function (snapshot)
								{

									usersRef.once("value", function (snapshot)
									{

										userRef.update(
										{
											context: "home"
										})

										usersRef.off("peer_review")
										getContextMessage(message, "peer_review", function (contextMessage)
										{
											bot.send(["Your document has been submitted! Make sure that people with access to the URL can make suggestions on the document.", contextMessage], message.from)
										})
									})
								})
							})
						}
						else if (message.body == "No")
						{
							peerRef.child("pending").child(encodedMessageFromUsername).set(null)
							userRef.update(
							{
								context: "submit_document"
							})

							getContextMessage(message, "submit_document", function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						else
						{
							getContextMessage(message, context, function (contextMessage)
							{
								bot.send(contextMessage, message.from)
							})
						}
						break

					case "review_document":
						var docTitles = []
						var titleMatch = false

						var docRef = peerRef.child("documents")

						peerRef.child("documents").on("child_added", function (snapshot)
						{
							if (snapshot.val().title == message.body)
							{
								titleMatch = true
								docRef = peerRef.child("documents").child(snapshot.key)
							}
						})

						docRef.once("value", function (snapshot)
						{
							if (titleMatch)
							{
								let reviewMessage = "Here is the URL to the document. Please make sure to tell " + snapshot.val().from + " that you reviewed their document after you're done."
								let urlMessage = Bot.Message.link(snapshot.val().url)

								getContextMessage(message, "review_document", function (contextMessage)
								{
									bot.send([reviewMessage, urlMessage, contextMessage], message.from)
								})

							}
							else
							{
								switch (message.body)
								{
									case "🔙 To Peer Review":
										userRef.update(
										{
											context: "peer_review"
										})

										getContextMessage(message, "peer_review", function (contextMessage)
										{
											bot.send([contextMessage], message.from)
										})
										break

									default:
										getContextMessage(message, context, function (contextMessage)
										{
											bot.send([contextMessage], message.from)
										})
										break
								}
							}
						})
						break

					default:
						sendErrorMessage(message, "context_error")
						break
				}
			}
		})
	})

	let server = http
		.createServer(bot.incoming())
		.listen(80)
	console.log("Server running")
